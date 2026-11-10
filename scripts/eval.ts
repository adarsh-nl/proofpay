/**
 * `npm run eval` — run the ProofPay eval set and write `eval/report.md`.
 *
 * For every `eval/pairs/<NN>-<slug>/case.json` with `"ready": true`:
 *   criteria (from `case.criteria`, else `generateCriteria`) -> ingest images into a
 *   temporary `UPLOAD_DIR` -> `verifyEvidence` -> `runForensics` (every other case counts
 *   as "another job", so re-used photos trigger duplicates, and `eval/stock/*` counts as
 *   known stock) -> `decide` -> compare with `expected`.
 *
 * The markdown report contains a per-case table, confusion matrix, outcome accuracy,
 * FALSE CAPTURES (expected ∉ {APPROVED, PARTIAL} but got APPROVED; target 0), false
 * holds, per-criterion accuracy where a case declares `expected.criteria`, flag counts
 * and latency.
 *
 * Flags
 *   --case <NN|slug>   run a single case (e.g. `--case 05`)
 *   --record           write the VLM report of each case to
 *                      `eval/fixtures/<sha256-of-first-after-image>.json` so
 *                      `VISION_MOCK=1` can replay real outputs. Refused in mock mode
 *                      unless --fixtures-dir is given, to keep mock reports out of the
 *                      committed fixtures.
 *   --pairs-dir <dir>  use another dataset directory (for the synthetic smoke test)
 *   --fixtures-dir <dir> override the fixture directory (default `eval/fixtures`)
 *   --report <file>    override the report path (default `eval/report.md`)
 *   --help
 *
 * Needs `--conditions=react-server` at startup (the npm script passes it) because the
 * vision modules import `server-only`.
 *
 * With no `ready:true` case the report says `0 cases evaluated; add photos per
 * docs/EVAL_SHOOT_GUIDE.md` and the process still exits 0.
 */
import './load-env';

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Criterion, JobCategory, VerificationReport } from '@/shared/contracts';
import { generateCriteria } from '@/server/vision/criteria';
import { applyLivenessCode, LIVENESS_CRITERION_TEMPLATE } from '@/server/vision/criteria-templates';
import { decide, type DecisionThresholds } from '@/server/vision/decide';
import {
  loadStockHashes,
  runForensics,
  type ForensicsEvidence,
  type StockImage,
} from '@/server/vision/forensics';
import { ingestImage } from '@/server/vision/ingest';
import { verifyEvidence, type VerifyImage } from '@/server/vision/verify';

import {
  CASE_DIR_PATTERN,
  CASE_IMAGE_PATTERN,
  EvalCaseSchema,
  moneyValueToCents,
  type EvalCase,
} from './eval-schema';

/* --------------------------------------------------------------------------- cli */

type CliOptions = {
  record: boolean;
  caseFilter: string | null;
  pairsDir: string;
  fixturesDir: string;
  fixturesDirExplicit: boolean;
  reportPath: string;
};

const DEFAULT_PAIRS_DIR = path.join(process.cwd(), 'eval', 'pairs');
const DEFAULT_FIXTURES_DIR = path.join(process.cwd(), 'eval', 'fixtures');
const DEFAULT_REPORT_PATH = path.join(process.cwd(), 'eval', 'report.md');
const TEMP_UPLOAD_DIR = path.join(process.cwd(), 'data', 'eval-tmp', 'uploads');

function printHelp(): void {
  console.info(
    [
      'ProofPay eval runner',
      '',
      'Usage: npm run eval -- [--case <NN|slug>] [--record] [--pairs-dir <dir>]',
      '                    [--fixtures-dir <dir>] [--report <file>]',
      '',
      '  --case <NN|slug>     run one case (e.g. 05 or 05-cleaning-reused-photo)',
      '  --record             write VLM outputs to eval/fixtures/<sha256>.json for mock mode',
      '  --pairs-dir <dir>    dataset directory (default eval/pairs)',
      '  --fixtures-dir <dir> fixture directory (default eval/fixtures)',
      '  --report <file>      report path (default eval/report.md)',
      '  --help               this text',
    ].join('\n'),
  );
}

function nextValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${flag} needs a value`);
  return value;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    record: false,
    caseFilter: null,
    pairsDir: DEFAULT_PAIRS_DIR,
    fixturesDir: DEFAULT_FIXTURES_DIR,
    fixturesDirExplicit: false,
    reportPath: DEFAULT_REPORT_PATH,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--record':
        options.record = true;
        break;
      case '--case':
        options.caseFilter = nextValue(argv, index, '--case');
        index += 1;
        break;
      case '--pairs-dir':
        options.pairsDir = path.resolve(nextValue(argv, index, '--pairs-dir'));
        index += 1;
        break;
      case '--fixtures-dir':
        options.fixturesDir = path.resolve(nextValue(argv, index, '--fixtures-dir'));
        options.fixturesDirExplicit = true;
        index += 1;
        break;
      case '--report':
        options.reportPath = path.resolve(nextValue(argv, index, '--report'));
        index += 1;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument: ${arg} (see --help)`);
    }
  }
  if (options.caseFilter !== null) options.caseFilter = options.caseFilter.trim().toLowerCase();
  return options;
}

/* ------------------------------------------------------------------------ setup */

const isMockMode = (): boolean => process.env.VISION_MOCK === '1';

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined || raw === '' ? Number.NaN : Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** MANUAL §9.4 defaults; read here instead of importing the server env module. */
function readThresholds(): DecisionThresholds {
  return {
    tPass: numberFromEnv('T_PASS', 0.9),
    tPartial: numberFromEnv('T_PARTIAL', 0.5),
    tConf: numberFromEnv('T_CONF', 0.75),
    tLowConf: numberFromEnv('T_LOW_CONF', 0.6),
    partialRoundTo: numberFromEnv('PARTIAL_ROUND_TO', 0.05),
  };
}

/* -------------------------------------------------------------------- dataset */

type LoadedCase = {
  dirName: string;
  number: number;
  dir: string;
  evalCase: EvalCase;
  beforeFiles: string[];
  afterFiles: string[];
};

function matchesCaseFilter(dirName: string, number: number, filter: string): boolean {
  if (dirName.toLowerCase().startsWith(filter)) return true;
  const numeric = Number.parseInt(filter, 10);
  return Number.isFinite(numeric) && numeric === number;
}

async function loadCases(pairsDir: string, filter: string | null): Promise<LoadedCase[]> {
  let entries;
  try {
    entries = await readdir(pairsDir, { withFileTypes: true });
  } catch {
    throw new Error(`dataset directory not found: ${pairsDir}`);
  }

  const cases: LoadedCase[] = [];
  for (const entry of entries.filter((item) => item.isDirectory() && !item.name.startsWith('.')).sort((a, b) => a.name.localeCompare(b.name))) {
    const dirName = entry.name;
    if (!CASE_DIR_PATTERN.test(dirName)) continue;
    const dir = path.join(pairsDir, dirName);

    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(path.join(dir, 'case.json'), 'utf8'));
    } catch {
      console.warn(`[eval] skipping ${dirName}: unreadable case.json`);
      continue;
    }
    const parsed = EvalCaseSchema.safeParse(raw);
    if (!parsed.success) {
      console.warn(`[eval] skipping ${dirName}: case.json does not match the schema (run npm run eval:validate)`);
      continue;
    }
    if (!parsed.data.ready) continue;

    const number = Number.parseInt(dirName.slice(0, 2), 10);
    if (filter !== null && !matchesCaseFilter(dirName, number, filter)) continue;

    const files = (await readdir(dir)).filter((file) => CASE_IMAGE_PATTERN.test(file)).sort();
    cases.push({
      dirName,
      number,
      dir,
      evalCase: parsed.data,
      beforeFiles: files.filter((file) => /^before_/i.test(file)),
      afterFiles: files.filter((file) => /^after_/i.test(file)),
    });
  }
  return cases;
}

/** Count the not-ready skeletons so the report can show what is missing. */
async function countPendingCases(pairsDir: string): Promise<number> {
  try {
    const entries = await readdir(pairsDir, { withFileTypes: true });
    let pending = 0;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      try {
        const raw: unknown = JSON.parse(await readFile(path.join(pairsDir, entry.name, 'case.json'), 'utf8'));
        const parsed = EvalCaseSchema.safeParse(raw);
        if (parsed.success && !parsed.data.ready) pending += 1;
      } catch {
        // not a case folder: ignore
      }
    }
    return pending;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------- evidence */

type CaseEvidence = {
  /** Rows handed to `runForensics` (subset of the DB evidence row). */
  rows: ForensicsEvidence[];
  /** Images handed to `verifyEvidence`, labelled B1.. / A1.. . */
  verifyBefore: VerifyImage[];
  verifyAfter: VerifyImage[];
};

const JOB_ID_PREFIX = 'eval-';

async function ingestEvidence(loaded: LoadedCase, uploadDir: string): Promise<CaseEvidence> {
  const jobId = `${JOB_ID_PREFIX}${loaded.dirName}`;
  const evidence: CaseEvidence = { rows: [], verifyBefore: [], verifyAfter: [] };

  const ingestPhase = async (
    files: string[],
    phase: 'before' | 'after',
  ): Promise<void> => {
    for (const [index, file] of files.entries()) {
      const original = await readFile(path.join(loaded.dir, file));
      const ingested = await ingestImage(original, {
        jobId,
        phase,
        uploadDir,
        index: index + 1,
      });
      const storedBytes = await readFile(path.join(uploadDir, ingested.storedPath));
      evidence.rows.push({
        id: `${jobId}-${phase}-${index + 1}`,
        jobId,
        phase,
        sha256: ingested.sha256,
        dhash: ingested.dhash,
        exifTakenAt: ingested.exifTakenAt,
      });
      const verifyImage: VerifyImage = {
        imageId: `${phase === 'before' ? 'B' : 'A'}${index + 1}`,
        buffer: storedBytes,
        mimeType: ingested.mime,
      };
      if (phase === 'before') evidence.verifyBefore.push(verifyImage);
      else evidence.verifyAfter.push(verifyImage);
    }
  };

  await ingestPhase(loaded.beforeFiles, 'before');
  await ingestPhase(loaded.afterFiles, 'after');
  if (evidence.verifyAfter.length === 0) {
    throw new Error('no after image to verify');
  }
  return evidence;
}

/* ------------------------------------------------------------------- criteria */

async function resolveCriteria(loaded: LoadedCase): Promise<Criterion[]> {
  const caseCriteria = loaded.evalCase.criteria;
  if (Array.isArray(caseCriteria) && caseCriteria.length > 0) {
    const jobCriteria: Criterion[] = caseCriteria.map((item) => ({
      id: item.id,
      label: item.label,
      howToVerify: item.howToVerify ?? `Compare the after photo with the checklist item "${item.label}".`,
      required: item.required,
      weight: item.weight,
      phase: 'after' as const,
      source: 'user' as const,
    }));
    const withSystem: Criterion[] = [
      ...jobCriteria,
      { ...LIVENESS_CRITERION_TEMPLATE, source: 'system' as const },
    ];
    return applyLivenessCode(withSystem, loaded.evalCase.livenessCode);
  }

  const generated = await generateCriteria({
    title: loaded.evalCase.title,
    description: loaded.evalCase.description,
    category: loaded.evalCase.category as JobCategory,
    amount: { currency: loaded.evalCase.amount.currency, value: loaded.evalCase.amount.value },
  });
  return applyLivenessCode(generated, loaded.evalCase.livenessCode);
}

/* --------------------------------------------------------------------- result */

type CriterionCheck = {
  checked: number;
  matched: number;
  mismatches: string[];
};

type CaseResult = {
  dirName: string;
  title: string;
  expectedPrimary: string;
  expectedAccepted: string[];
  got: string;
  primaryMatch: boolean;
  acceptedMatch: boolean;
  score: number | null;
  captureValue: string | null;
  flags: string[];
  criterionCheck: CriterionCheck;
  latencyMs: number;
  recordedFixture: string | null;
  error: string | null;
};

async function writeRecordedFixture(
  report: VerificationReport,
  fixtureSha: string | null,
  fixturesDir: string,
): Promise<string | null> {
  if (fixtureSha === null || !/^[0-9a-f]{64}$/.test(fixtureSha)) return null;
  await mkdir(fixturesDir, { recursive: true });
  const file = path.join(fixturesDir, `${fixtureSha}.json`);
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`);
  return file;
}

async function runCase(
  loaded: LoadedCase,
  evidence: CaseEvidence,
  allEvidence: ForensicsEvidence[],
  stock: StockImage[],
  options: CliOptions,
  thresholds: DecisionThresholds,
): Promise<CaseResult> {
  const started = Date.now();
  const expected = loaded.evalCase.expected;
  const accepted = [expected.outcome, ...expected.alternatives];
  const base: CaseResult = {
    dirName: loaded.dirName,
    title: loaded.evalCase.title,
    expectedPrimary: expected.outcome,
    expectedAccepted: accepted,
    got: 'ERROR',
    primaryMatch: false,
    acceptedMatch: false,
    score: null,
    captureValue: null,
    flags: [],
    criterionCheck: { checked: 0, matched: 0, mismatches: [] },
    latencyMs: 0,
    recordedFixture: null,
    error: null,
  };

  try {
    const criteria = await resolveCriteria(loaded);
    const firstAfter = evidence.rows.find((row) => row.phase === 'after');
    const report = await verifyEvidence({
      criteria,
      before: evidence.verifyBefore,
      after: evidence.verifyAfter,
      livenessCode: loaded.evalCase.livenessCode,
      category: loaded.evalCase.category,
      firstAfterSha256: firstAfter?.sha256 ?? null,
    });

    if (options.record) {
      base.recordedFixture = await writeRecordedFixture(report, firstAfter?.sha256 ?? null, options.fixturesDir);
    }

    const otherEvidence = allEvidence.filter((row) => row.jobId !== `${JOB_ID_PREFIX}${loaded.dirName}`);
    const authorizedAt = evidence.rows.find((row) => row.phase === 'before' && row.exifTakenAt)?.exifTakenAt ?? null;
    const forensics = runForensics({
      job: { id: `${JOB_ID_PREFIX}${loaded.dirName}` },
      evidence: evidence.rows,
      otherEvidence,
      stock,
      authorizedAt,
      vlmReport: report,
    });

    const decision = decide({
      criteria,
      report,
      forensics,
      amountCents: moneyValueToCents(loaded.evalCase.amount.value),
      currency: loaded.evalCase.amount.currency,
      thresholds,
    });

    base.got = decision.outcome;
    base.primaryMatch = decision.outcome === expected.outcome;
    base.acceptedMatch = accepted.includes(decision.outcome);
    base.score = Math.round(decision.score * 10000) / 10000;
    base.captureValue = decision.captureAmount?.value ?? null;
    base.flags = forensics.flags.map((flag) => `${flag.level}:${flag.code}`);

    const verdictById = new Map(report.verdicts.map((verdict) => [verdict.criterionId, verdict.verdict]));
    for (const [criterionId, expectedVerdict] of Object.entries(expected.criteria)) {
      base.criterionCheck.checked += 1;
      const gotVerdict = verdictById.get(criterionId) ?? 'MISSING';
      if (gotVerdict === expectedVerdict) base.criterionCheck.matched += 1;
      else base.criterionCheck.mismatches.push(`${criterionId}: expected ${expectedVerdict}, got ${gotVerdict}`);
    }
  } catch (error) {
    base.error = error instanceof Error ? error.message : String(error);
  }

  base.latencyMs = Date.now() - started;
  return base;
}

/* --------------------------------------------------------------------- report */

type ReportInput = {
  options: CliOptions;
  results: CaseResult[];
  pendingCases: number;
  datasetSize: number;
  mock: boolean;
  model: string;
  startedAt: string;
};

const isCaptureOutcome = (outcome: string): boolean => outcome === 'APPROVED' || outcome === 'PARTIAL';

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2;
}

function pct(part: number, total: number): string {
  if (total === 0) return 'n/a';
  return `${((part / total) * 100).toFixed(1)}%`;
}

function renderReport({ options, results, pendingCases, datasetSize, mock, model, startedAt }: ReportInput): string {
  const lines: string[] = [];
  const evaluated = results.filter((result) => result.error === null);
  const errored = results.filter((result) => result.error !== null);
  const primaryCorrect = evaluated.filter((result) => result.primaryMatch).length;
  const acceptedCorrect = evaluated.filter((result) => result.acceptedMatch).length;

  const falseCaptures = evaluated.filter(
    (result) => !isCaptureOutcome(result.expectedPrimary) && result.got === 'APPROVED',
  );
  const falseHolds = evaluated.filter(
    (result) => isCaptureOutcome(result.expectedPrimary) && result.got === 'HUMAN_REVIEW',
  );
  const falseRejects = evaluated.filter(
    (result) => isCaptureOutcome(result.expectedPrimary) && result.got === 'REJECTED',
  );

  const latencies = results.map((result) => result.latencyMs);
  const meanLatency = latencies.length === 0 ? 0 : Math.round(latencies.reduce((sum, value) => sum + value, 0) / latencies.length);

  const criterionChecked = evaluated.reduce((sum, result) => sum + result.criterionCheck.checked, 0);
  const criterionMatched = evaluated.reduce((sum, result) => sum + result.criterionCheck.matched, 0);

  const selected = options.caseFilter === null ? 'all ready cases' : `case filter "${options.caseFilter}"`;

  lines.push('# ProofPay eval report');
  lines.push('');
  const datasetLabel = path.relative(process.cwd(), options.pairsDir) || 'eval/pairs';
  lines.push(`Generated by \`npm run eval\` at ${startedAt} · dataset \`${datasetLabel}\` · ${selected}.`);
  lines.push('');
  if (mock) {
    lines.push('> **MOCK MODE** — `VISION_MOCK=1`: the verifier returns the deterministic mock');
    lines.push('> report, so these numbers are **synthetic and must not be quoted as accuracy**.');
    lines.push('> Run with a real AI key and `VISION_MOCK=0` for real numbers:');
    lines.push('> `VISION_MOCK=0 npm run eval -- --record` (then commit `eval/fixtures/`).');
  } else {
    lines.push(`> **LIVE MODE** — real vision-model calls (\`VLM_MODEL=${model}\`).`);
  }
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push(`- cases evaluated: **${evaluated.length}** of ${datasetSize} ready cases${pendingCases > 0 ? ` (${pendingCases} skeleton case(s) still need photos)` : ''}`);
  lines.push(`- outcome accuracy (primary label): **${primaryCorrect}/${evaluated.length}** (${pct(primaryCorrect, evaluated.length)})`);
  lines.push(`- outcome accuracy (counting documented alternatives): **${acceptedCorrect}/${evaluated.length}** (${pct(acceptedCorrect, evaluated.length)})`);
  lines.push(`- **FALSE CAPTURES: ${falseCaptures.length}** (target 0)${falseCaptures.length === 0 ? ' ✅' : ' ❌'}`);
  lines.push(`- false holds (expected capture, got HUMAN_REVIEW): ${falseHolds.length}`);
  lines.push(`- false rejects (expected capture, got REJECTED): ${falseRejects.length}`);
  lines.push(`- cases with errors: ${errored.length}`);
  lines.push(`- latency: mean ${meanLatency} ms · median ${median(latencies)} ms per case`);
  lines.push(`- per-criterion accuracy: ${criterionMatched}/${criterionChecked} expected verdicts matched`);
  lines.push('- token/cost estimate: not available (`verifyEvidence` does not expose token usage)');
  lines.push('');

  lines.push('## Per case');
  lines.push('');
  lines.push('| # | case | expected | got | ok | accepted | score | capture | flags | criteria | ms |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const result of results) {
    const number = result.dirName.slice(0, 2);
    const name = result.dirName.slice(3);
    const ok = result.error === null ? (result.primaryMatch ? '✅' : '❌') : '💥';
    const accepted = result.error === null ? (result.acceptedMatch ? 'yes' : 'no') : '-';
    const criteria = result.criterionCheck.checked > 0
      ? `${result.criterionCheck.matched}/${result.criterionCheck.checked}`
      : '-';
    const flags = result.flags.length > 0 ? result.flags.join(' ') : '-';
    lines.push(
      `| ${number} | ${name} | ${result.expectedPrimary}${result.expectedAccepted.length > 1 ? ` (alt: ${result.expectedAccepted.slice(1).join(', ')})` : ''} | ${result.error === null ? result.got : 'ERROR'} | ${ok} | ${accepted} | ${result.score === null ? '-' : result.score.toFixed(2)} | ${result.captureValue === null ? '-' : `$${result.captureValue}`} | ${flags} | ${criteria} | ${result.latencyMs} |`,
    );
  }
  lines.push('');

  lines.push('## Confusion matrix');
  lines.push('');
  const outcomes = ['APPROVED', 'PARTIAL', 'REJECTED', 'HUMAN_REVIEW'];
  lines.push(`| expected \\ got | ${outcomes.join(' | ')} | total |`);
  lines.push(`|---|${outcomes.map(() => '---').join('|')}|---|`);
  for (const expectedOutcome of outcomes) {
    const row = evaluated.filter((result) => result.expectedPrimary === expectedOutcome);
    const counts = outcomes.map((got) => row.filter((result) => result.got === got).length);
    lines.push(`| ${expectedOutcome} | ${counts.join(' | ')} | ${row.length} |`);
  }
  const gotTotals = outcomes.map((got) => evaluated.filter((result) => result.got === got).length);
  lines.push(`| **total** | ${gotTotals.join(' | ')} | ${evaluated.length} |`);
  lines.push('');

  if (criterionChecked > 0) {
    lines.push('## Criterion mismatches');
    lines.push('');
    const mismatches = evaluated.flatMap((result) =>
      result.criterionCheck.mismatches.map((mismatch) => `- ${result.dirName}: ${mismatch}`),
    );
    lines.push(...(mismatches.length > 0 ? mismatches : ['- none: every declared expected verdict matched']));
    lines.push('');
  }

  const flagCounts = new Map<string, number>();
  for (const result of evaluated) {
    for (const composed of result.flags) {
      flagCounts.set(composed, (flagCounts.get(composed) ?? 0) + 1);
    }
  }
  if (flagCounts.size > 0) {
    lines.push('## Forensics flags');
    lines.push('');
    for (const [code, count] of [...flagCounts.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`- ${code}: ${count}`);
    }
    lines.push('');
  }

  if (errored.length > 0) {
    lines.push('## Errors');
    lines.push('');
    for (const result of errored) lines.push(`- ${result.dirName}: ${result.error ?? 'unknown error'}`);
    lines.push('');
  }

  if (options.record) {
    lines.push('## Recorded fixtures');
    lines.push('');
    const recorded = results.filter((result) => result.recordedFixture !== null);
    if (recorded.length === 0) {
      lines.push('- none: no `after` image sha256 was available or the run failed');
    } else {
      for (const result of recorded) {
        lines.push(`- ${result.dirName} → ${path.relative(process.cwd(), result.recordedFixture ?? '')}`);
      }
    }
    lines.push('');
  }

  lines.push('## Notes / assumptions');
  lines.push('');
  lines.push('- Every other case in the dataset is treated as "another job" for the duplicate checks, and `eval/stock/*` as known stock photos.');
  lines.push('- `authorizedAt` for the EXIF window check is the first `before` photo timestamp found in the dataset (or unset when no photo has EXIF).');
  lines.push('- Cases that declare `expected.criteria` are scored on those verdicts; other cases are scored on the outcome only.');
  lines.push('- MANUAL §9.5 rows that allow two outcomes list the extra one in `expected.alternatives`; both are accepted here and the primary label is used in the confusion matrix.');
  lines.push('');
  return lines.join('\n');
}

function renderEmptyReport({ options, pendingCases, datasetSize, mock, startedAt }: ReportInput): string {
  const lines: string[] = [];
  lines.push('# ProofPay eval report');
  lines.push('');
  const datasetLabel = path.relative(process.cwd(), options.pairsDir) || 'eval/pairs';
  lines.push(`Generated by \`npm run eval\` at ${startedAt} · dataset \`${datasetLabel}\`.`);
  lines.push('');
  if (mock) {
    lines.push('> **MOCK MODE** — `VISION_MOCK=1` (no AI key). Keep this in mind when reading any number.');
    lines.push('');
  }
  lines.push('## Summary');
  lines.push('');
  lines.push(`**0 cases evaluated; add photos per docs/EVAL_SHOOT_GUIDE.md**`);
  lines.push('');
  lines.push(`- ${datasetSize + pendingCases} case skeleton(s) committed, ${pendingCases} still waiting for before/after photos (\`"ready": false\`).`);
  if (options.caseFilter !== null) lines.push(`- case filter was \`${options.caseFilter}\` — no ready case matched it.`);
  lines.push('- The eval set is human-shot by design (MANUAL §9.5): flip `"ready": true` once a case has its photos, then re-run `npm run eval`.');
  lines.push('');
  return lines.join('\n');
}

/* ----------------------------------------------------------------------- main */

async function main(): Promise<number> {
  const options = parseArgs(process.argv.slice(2));
  const mock = isMockMode();
  const startedAt = new Date().toISOString();
  const model = process.env.VLM_MODEL || '(provider default)';
  const datasetSize = (await loadCases(options.pairsDir, null)).length;
  const pendingCases = await countPendingCases(options.pairsDir);

  if (options.record && mock && !options.fixturesDirExplicit) {
    console.error(
      '[eval] refusing to --record in MOCK mode: mock reports must not become committed fixtures (they would shadow real VLM outputs).',
    );
    console.error('[eval] set VISION_MOCK=0 with a real AI key, or pass --fixtures-dir <tmp> for a mechanics test.');
    return 1;
  }

  const cases = await loadCases(options.pairsDir, options.caseFilter);

  if (cases.length === 0) {
    const report = renderEmptyReport({ options, results: [], pendingCases, datasetSize, mock, model, startedAt });
    await mkdir(path.dirname(options.reportPath), { recursive: true });
    await writeFile(options.reportPath, report);
    console.info('[eval] 0 cases evaluated; add photos per docs/EVAL_SHOOT_GUIDE.md');
    console.info(`[eval] report written to ${path.relative(process.cwd(), options.reportPath)} (mode: ${mock ? 'MOCK' : 'LIVE'})`);
    return 0;
  }

  const thresholds = readThresholds();
  const uploadDir = TEMP_UPLOAD_DIR;
  // Only clean the temporary upload directory: --pairs-dir may legitimately live inside
  // data/eval-tmp too (scripts/eval-synthetic.ts), so never delete the whole temp root.
  await rm(uploadDir, { recursive: true, force: true });
  await mkdir(uploadDir, { recursive: true });

  const stock = await loadStockHashes(path.join(process.cwd(), 'eval', 'stock'));
  console.info(
    `[eval] ${cases.length} ready case(s) · mode=${mock ? 'MOCK' : 'LIVE'} · stock=${stock.length} · thresholds tPass=${thresholds.tPass} tPartial=${thresholds.tPartial}`,
  );

  const evidenceByCase = new Map<string, CaseEvidence>();
  const allEvidence: ForensicsEvidence[] = [];
  const prepareErrors = new Map<string, string>();

  for (const loaded of cases) {
    try {
      const evidence = await ingestEvidence(loaded, uploadDir);
      evidenceByCase.set(loaded.dirName, evidence);
      allEvidence.push(...evidence.rows);
    } catch (error) {
      prepareErrors.set(loaded.dirName, error instanceof Error ? error.message : String(error));
      console.warn(`[eval] ${loaded.dirName}: could not ingest images: ${prepareErrors.get(loaded.dirName)}`);
    }
  }

  const results: CaseResult[] = [];
  for (const loaded of cases) {
    const evidence = evidenceByCase.get(loaded.dirName);
    if (!evidence) {
      results.push({
        dirName: loaded.dirName,
        title: loaded.evalCase.title,
        expectedPrimary: loaded.evalCase.expected.outcome,
        expectedAccepted: [loaded.evalCase.expected.outcome, ...loaded.evalCase.expected.alternatives],
        got: 'ERROR',
        primaryMatch: false,
        acceptedMatch: false,
        score: null,
        captureValue: null,
        flags: [],
        criterionCheck: { checked: 0, matched: 0, mismatches: [] },
        latencyMs: 0,
        recordedFixture: null,
        error: prepareErrors.get(loaded.dirName) ?? 'image ingestion failed',
      });
      continue;
    }
    const result = await runCase(loaded, evidence, allEvidence, stock, options, thresholds);
    results.push(result);
    console.info(
      `[eval] ${result.dirName}: expected=${result.expectedPrimary} got=${result.got} ${result.acceptedMatch ? 'OK' : 'MISMATCH'} (${result.latencyMs} ms)${result.error ? ` error=${result.error}` : ''}`,
    );
  }

  const report = renderReport({ options, results, pendingCases, datasetSize, mock, model, startedAt });
  await mkdir(path.dirname(options.reportPath), { recursive: true });
  await writeFile(options.reportPath, report);

  const evaluated = results.filter((result) => result.error === null);
  const primaryCorrect = evaluated.filter((result) => result.primaryMatch).length;
  const acceptedCorrect = evaluated.filter((result) => result.acceptedMatch).length;
  const falseCaptures = evaluated.filter(
    (result) => !isCaptureOutcome(result.expectedPrimary) && result.got === 'APPROVED',
  ).length;

  console.info(
    `[eval] cases=${evaluated.length} primary=${primaryCorrect}/${evaluated.length} accepted=${acceptedCorrect}/${evaluated.length} falseCaptures=${falseCaptures} mode=${mock ? 'MOCK' : 'LIVE'}`,
  );
  console.info(`[eval] report written to ${path.relative(process.cwd(), options.reportPath)}`);
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error('[eval] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });

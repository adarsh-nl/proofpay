/**
 * Typed API client for every ProofPay endpoint (docs/MANUAL.md §8).
 *
 * - Responses are parsed with the zod schemas from `src/shared/contracts.ts`, so
 *   a backend contract drift shows up as a clear `ApiClientError` instead of an
 *   undefined property in a component.
 * - Until the API routes exist, `NEXT_PUBLIC_USE_FIXTURES=1` serves the demo jobs
 *   from `src/lib/fixtures/*.json` through this same client, so components never
 *   change when the real routes land.
 * - All UI data fetching goes through this module (AGENTS.md §8); components must
 *   not call `fetch('/api/…')` directly.
 */

import { z } from 'zod';

import {
  ApiErrorSchema,
  EvidenceItemSchema,
  JobListResponseSchema,
  JobResponseSchema,
  JobSchema,
  VerificationBundleSchema,
  type AcceptBody,
  type AuthorizeBody,
  type CreateJobBody,
  type CreateOrderBody,
  type DeclineBody,
  type EvidenceItem,
  type EvidencePhase,
  type Job,
  type JobListItem,
  type RefundBody,
  type ReviewBody,
  type UpdateCriteriaBody,
  type VerificationBundle,
  type VerifyBody,
  type VoidBody,
} from '@/shared/contracts';

import jobBikeFixture from './fixtures/job-demo-bike.json';
import jobCleaningFixture from './fixtures/job-demo-cleaning.json';
import jobPartialFixture from './fixtures/job-demo-partial.json';
import jobsFixture from './fixtures/jobs.json';
import verificationFixture from './fixtures/verification.json';

export interface ApiRequestOptions {
  /** Absolute origin for server-side calls; empty/relative works in the browser. */
  baseUrl?: string;
  /** Extra headers, e.g. the `pp_role` cookie forwarded from a server component. */
  headers?: HeadersInit;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const FIXTURE_MODE = process.env.NEXT_PUBLIC_USE_FIXTURES === '1';

const EvidenceResponseSchema = z.object({ evidence: z.array(EvidenceItemSchema) });
const EvidencePackResponseSchema = z.object({ markdown: z.string() });
const VerifyResponseSchema = z.object({
  verification: VerificationBundleSchema,
  job: JobSchema,
});
const CreateOrderResponseSchema = z.object({ orderId: z.string() });
const HealthResponseSchema = z.object({
  ok: z.boolean(),
  mockVision: z.boolean(),
  mockPaypal: z.boolean().optional(),
  paypalEnv: z.string(),
});

function mergeHeaders(headers: HeadersInit | undefined, extra: HeadersInit | undefined): Headers {
  const merged = new Headers(headers);
  if (extra) {
    new Headers(extra).forEach((value, key) => merged.set(key, value));
  }
  return merged;
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
  options: ApiRequestOptions = {},
): Promise<T> {
  const url = `${options.baseUrl ?? ''}${path}`;
  const headers = mergeHeaders(init.headers, options.headers);
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !isFormData) headers.set('content-type', 'application/json');

  let response: Response;
  try {
    response = await fetch(url, { ...init, headers, cache: 'no-store' });
  } catch {
    throw new ApiClientError(
      'NETWORK_ERROR',
      'Could not reach the ProofPay API. Is the server running?',
      0,
    );
  }

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    const parsed = ApiErrorSchema.safeParse(payload);
    if (parsed.success) {
      throw new ApiClientError(
        parsed.data.error.code,
        parsed.data.error.message,
        response.status,
        parsed.data.error.details,
      );
    }
    throw new ApiClientError(
      `HTTP_${response.status}`,
      `Request failed (${response.status} ${response.statusText})`,
      response.status,
    );
  }

  if (response.status === 204) {
    return schema.parse(undefined);
  }
  const payload: unknown = await response.json();
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError(
      'INVALID_RESPONSE',
      'The server returned data that does not match the ProofPay contract.',
      502,
      parsed.error.issues,
    );
  }
  return parsed.data;
}

/* ------------------------------------------------------------------ fixtures */

const FIXTURE_JOBS = {
  'demo-bike': JobSchema.parse(jobBikeFixture),
  'demo-cleaning': JobSchema.parse(jobCleaningFixture),
  'demo-partial': JobSchema.parse(jobPartialFixture),
} satisfies Record<string, Job>;

const FIXTURE_JOB_LIST: JobListItem[] = JobListResponseSchema.parse(jobsFixture).jobs;
const FIXTURE_VERIFICATION = VerificationBundleSchema.parse(verificationFixture);

/** The fixture store is intentionally tiny: it powers page rendering until the
 * API routes merge (`NEXT_PUBLIC_USE_FIXTURES=1`). It is not a fake backend. */
const fixtureStore = new Map<string, Job>(Object.entries(FIXTURE_JOBS));

/** Captured partial of the cleaning job, so the timeline can render
 * Held $120 → AI verified 4/5 → Captured $96 → Released $24. */
const settledPartial = FIXTURE_JOBS['demo-partial'];
if (settledPartial.payment) {
  fixtureStore.set('demo-settled', {
    ...settledPartial,
    id: 'demo-settled',
    status: 'CAPTURED',
    payment: {
      ...settledPartial.payment,
      captured: { currency: 'USD', value: '96.00' },
      captureIds: ['MOCK-CAP-1'],
    },
  });
}

function fixtureJobOrFallback(id: string): Job {
  const existing = fixtureStore.get(id);
  if (existing) return existing;
  const base = FIXTURE_JOBS['demo-bike'];
  return { ...base, id, updatedAt: new Date().toISOString() };
}

function withStatus(job: Job, patch: Partial<Job>): Job {
  const next = { ...job, ...patch, updatedAt: new Date().toISOString() };
  fixtureStore.set(next.id, next);
  return next;
}

function fixtureMarkdown(job: Job): string {
  const verdicts = (job.latestVerification?.report.verdicts ?? [])
    .map((verdict) => `| ${verdict.criterionId} | ${verdict.verdict} | ${verdict.rationale} |`)
    .join('\n');
  return [
    `# Evidence pack: ${job.title}`,
    '',
    `- Job: \`${job.id}\``,
    `- Amount: ${job.amount.value} ${job.amount.currency}`,
    `- Status: ${job.status}`,
    '',
    '| Criterion | Verdict | Rationale |',
    '| --- | --- | --- |',
    verdicts || '| — | — | No verification yet |',
    '',
    '_Generated from the ProofPay demo fixtures (backend route not merged yet)._',
  ].join('\n');
}

/* -------------------------------------------------------------------- client */

async function jsonBody<T>(body: T): Promise<string> {
  return JSON.stringify(body);
}

export const api = {
  /** MANUAL §8 #1 */
  async createJob(body: CreateJobBody, options?: ApiRequestOptions): Promise<Job> {
    if (FIXTURE_MODE) {
      const base = FIXTURE_JOBS['demo-bike'];
      const id = `demo-${Date.now().toString(36)}`;
      const job: Job = {
        ...base,
        id,
        title: body.title,
        description: body.description,
        category: body.category,
        amount: body.amount,
        status: 'CREATED',
        customerName: body.customerName,
        workerName: body.workerName,
        payment: undefined,
        latestVerification: undefined,
        events: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      fixtureStore.set(job.id, job);
      return job;
    }
    const response = await request(
      '/api/jobs',
      JobResponseSchema,
      { method: 'POST', body: await jsonBody(body) },
      options,
    );
    return response.job;
  },

  /** MANUAL §8 #2 */
  async listJobs(options?: ApiRequestOptions): Promise<JobListItem[]> {
    if (FIXTURE_MODE) return FIXTURE_JOB_LIST;
    const response = await request('/api/jobs', JobListResponseSchema, { method: 'GET' }, options);
    return response.jobs;
  },

  /** MANUAL §8 #3 */
  async getJob(id: string, options?: ApiRequestOptions): Promise<Job> {
    if (FIXTURE_MODE) return fixtureJobOrFallback(id);
    const response = await request(
      `/api/jobs/${encodeURIComponent(id)}`,
      JobResponseSchema,
      { method: 'GET' },
      options,
    );
    return response.job;
  },

  /** MANUAL §8 #4 */
  async updateCriteria(
    id: string,
    body: UpdateCriteriaBody,
    options?: ApiRequestOptions,
  ): Promise<Job> {
    if (FIXTURE_MODE) {
      const job = fixtureJobOrFallback(id);
      return withStatus(job, { criteria: body.criteria });
    }
    const response = await request(
      `/api/jobs/${encodeURIComponent(id)}/criteria`,
      JobResponseSchema,
      { method: 'PUT', body: await jsonBody(body) },
      options,
    );
    return response.job;
  },

  /** MANUAL §8 #5 */
  async createOrder(
    body: CreateOrderBody,
    options?: ApiRequestOptions,
  ): Promise<{ orderId: string }> {
    if (FIXTURE_MODE) return { orderId: 'MOCK-ORDER-FIXTURE' };
    return request(
      '/api/paypal/orders',
      CreateOrderResponseSchema,
      { method: 'POST', body: await jsonBody(body) },
      options,
    );
  },

  /** MANUAL §8 #6 */
  async authorize(orderId: string, body: AuthorizeBody, options?: ApiRequestOptions): Promise<Job> {
    if (FIXTURE_MODE) {
      const job = fixtureJobOrFallback(body.jobId);
      return withStatus(job, {
        status: 'AUTHORIZED',
        livenessCode: '4821',
        payment: {
          orderId,
          authorizationId: 'MOCK-AUTH-FIXTURE',
          authorizationStatus: 'CREATED',
          authorized: job.amount,
          captured: { currency: job.amount.currency, value: '0.00' },
          refunded: { currency: job.amount.currency, value: '0.00' },
          captureIds: [],
          expiresAt: new Date(Date.now() + 29 * 86_400_000).toISOString(),
          honorPeriodEndsAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        },
      });
    }
    const response = await request(
      `/api/paypal/orders/${encodeURIComponent(orderId)}/authorize`,
      JobResponseSchema,
      { method: 'POST', body: await jsonBody(body) },
      options,
    );
    return response.job;
  },

  /** Photos already stored for this job (GET /api/jobs/:id/evidence). */
  async listEvidence(id: string, options?: ApiRequestOptions): Promise<EvidenceItem[]> {
    if (FIXTURE_MODE) return [];
    const response = await request(
      `/api/jobs/${encodeURIComponent(id)}/evidence`,
      EvidenceResponseSchema,
      { method: 'GET' },
      options,
    );
    return response.evidence;
  },

  /** MANUAL §8 #7 */
  async uploadEvidence(
    id: string,
    phase: EvidencePhase,
    files: File[],
    options?: ApiRequestOptions,
  ): Promise<EvidenceItem[]> {
    if (FIXTURE_MODE) {
      return files.map((file, index) => ({
        id: `ev_${phase}_${index}`,
        jobId: id,
        phase,
        sha256: '0'.repeat(64),
        dhash: '0'.repeat(16),
        width: 800,
        height: 600,
        mime: file.type || 'image/jpeg',
        exifTakenAt: null,
        uploadedAt: new Date().toISOString(),
        url: '',
      }));
    }
    const form = new FormData();
    form.append('phase', phase);
    files.forEach((file) => form.append('files', file));
    const response = await request(
      `/api/jobs/${encodeURIComponent(id)}/evidence`,
      EvidenceResponseSchema,
      { method: 'POST', body: form },
      options,
    );
    return response.evidence;
  },

  /** MANUAL §8 #8 */
  async deleteEvidence(
    id: string,
    evidenceId: string,
    options?: ApiRequestOptions,
  ): Promise<void> {
    if (FIXTURE_MODE) return;
    await request(
      `/api/jobs/${encodeURIComponent(id)}/evidence/${encodeURIComponent(evidenceId)}`,
      z.void(),
      { method: 'DELETE' },
      options,
    );
  },

  /** MANUAL §8 #9 */
  async submitEvidence(id: string, options?: ApiRequestOptions): Promise<Job> {
    if (FIXTURE_MODE) {
      const job = fixtureJobOrFallback(id);
      return withStatus(job, { status: 'EVIDENCE_SUBMITTED' });
    }
    const response = await request(
      `/api/jobs/${encodeURIComponent(id)}/submit`,
      JobResponseSchema,
      { method: 'POST', body: await jsonBody({}) },
      options,
    );
    return response.job;
  },

  /** MANUAL §8 #10 */
  async verify(
    id: string,
    body: VerifyBody = {},
    options?: ApiRequestOptions,
  ): Promise<{ job: Job; verification: VerificationBundle }> {
    if (FIXTURE_MODE) {
      const job = fixtureJobOrFallback(id);
      const next = withStatus(job, {
        status: 'PARTIAL',
        latestVerification: FIXTURE_VERIFICATION,
      });
      return { job: next, verification: FIXTURE_VERIFICATION };
    }
    return request(
      `/api/jobs/${encodeURIComponent(id)}/verify`,
      VerifyResponseSchema,
      { method: 'POST', body: await jsonBody(body) },
      options,
    );
  },

  /** MANUAL §8 #11 */
  async acceptProposal(
    id: string,
    body: AcceptBody,
    options?: ApiRequestOptions,
  ): Promise<Job> {
    if (FIXTURE_MODE) {
      const job = fixtureJobOrFallback(id);
      const captured = job.latestVerification?.decision.captureAmount;
      return withStatus(job, {
        status: 'CAPTURED',
        payment: job.payment
          ? {
              ...job.payment,
              captured: captured ?? job.amount,
              captureIds: ['MOCK-CAP-FIXTURE'],
            }
          : undefined,
      });
    }
    const response = await request(
      `/api/jobs/${encodeURIComponent(id)}/settlement/accept`,
      JobResponseSchema,
      { method: 'POST', body: await jsonBody(body) },
      options,
    );
    return response.job;
  },

  /** MANUAL §8 #12 */
  async declineProposal(
    id: string,
    body: DeclineBody,
    options?: ApiRequestOptions,
  ): Promise<Job> {
    if (FIXTURE_MODE) {
      const job = fixtureJobOrFallback(id);
      return withStatus(job, { status: 'HUMAN_REVIEW' });
    }
    const response = await request(
      `/api/jobs/${encodeURIComponent(id)}/settlement/decline`,
      JobResponseSchema,
      { method: 'POST', body: await jsonBody(body) },
      options,
    );
    return response.job;
  },

  /** MANUAL §8 #13 */
  async review(id: string, body: ReviewBody, options?: ApiRequestOptions): Promise<Job> {
    if (FIXTURE_MODE) {
      const job = fixtureJobOrFallback(id);
      const status = body.decision === 'REJECT' ? 'VOIDED' : 'CAPTURED';
      return withStatus(job, { status });
    }
    const response = await request(
      `/api/jobs/${encodeURIComponent(id)}/review`,
      JobResponseSchema,
      { method: 'POST', body: await jsonBody(body) },
      options,
    );
    return response.job;
  },

  /** MANUAL §8 #14 */
  async voidJob(id: string, body: VoidBody, options?: ApiRequestOptions): Promise<Job> {
    if (FIXTURE_MODE) {
      const job = fixtureJobOrFallback(id);
      return withStatus(job, { status: 'VOIDED' });
    }
    const response = await request(
      `/api/jobs/${encodeURIComponent(id)}/void`,
      JobResponseSchema,
      { method: 'POST', body: await jsonBody(body) },
      options,
    );
    return response.job;
  },

  /** MANUAL §8 #15 */
  async refund(id: string, body: RefundBody, options?: ApiRequestOptions): Promise<Job> {
    if (FIXTURE_MODE) {
      const job = fixtureJobOrFallback(id);
      return withStatus(job, { status: 'REFUNDED' });
    }
    const response = await request(
      `/api/jobs/${encodeURIComponent(id)}/refund`,
      JobResponseSchema,
      { method: 'POST', body: await jsonBody(body) },
      options,
    );
    return response.job;
  },

  /** MANUAL §8 #17 */
  async reviewQueue(options?: ApiRequestOptions): Promise<JobListItem[]> {
    if (FIXTURE_MODE) return FIXTURE_JOB_LIST.filter((job) => job.status === 'HUMAN_REVIEW');
    const response = await request('/api/review-queue', JobListResponseSchema, { method: 'GET' }, options);
    return response.jobs;
  },

  /** MANUAL §8 #18 */
  async evidencePack(id: string, options?: ApiRequestOptions): Promise<string> {
    if (FIXTURE_MODE) return fixtureMarkdown(fixtureJobOrFallback(id));
    const response = await request(
      `/api/jobs/${encodeURIComponent(id)}/agent/evidence-pack`,
      EvidencePackResponseSchema,
      { method: 'POST', body: await jsonBody({}) },
      options,
    );
    return response.markdown;
  },

  /** MANUAL §8 #21 */
  async health(options?: ApiRequestOptions): Promise<z.infer<typeof HealthResponseSchema>> {
    return request('/api/health', HealthResponseSchema, { method: 'GET' }, options);
  },
} as const;

export type Api = typeof api;

/** Same-origin URL that serves an evidence image (endpoint #20); `url` comes from the API. */
export function evidenceUrl(evidence: Pick<EvidenceItem, 'url'>): string {
  return evidence.url;
}

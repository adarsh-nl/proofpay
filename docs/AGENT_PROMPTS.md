# Agent starter prompts

Copy‑paste one block per task into the lane named on the task. Every prompt assumes `AGENTS.md` is loaded.
Before pasting: set the Notion row to **In progress** and create the branch (`git switch -c <branch>` or a worktree, see `docs/COLLABORATION.md` §2).

**Universal preamble.** Already embedded in each block below; shown here once for reference:
> You are working on ProofPay (see AGENTS.md). Task <ID>: <title>. Branch: <branch>. Only modify paths your lane owns (AGENTS.md §4). Read AGENTS.md, docs/MANUAL.md sections referenced below, and src/shared/contracts.ts first. Make a short plan, then implement in small commits `<ID>: …`. Run `npm run check` until green. Don't print secrets. Finish by opening a PR `[<ID>] <title>` with the template, then output the AGENTS.md §10 hand‑off block. If a needed change is outside your paths, stop and describe it instead.

---

## T00

**Repo bootstrap: Next.js+TS scaffold, tooling, scripts, CI** · Owner: Adarsh · Lane: **Backend lane** · Slot: Tue 14:00–16:00 · Est: 0.75 h · Depends on: — · Branch: `feat/T00-bootstrap`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T00: Repo bootstrap: Next.js+TS scaffold, tooling, scripts, CI.
Branch: feat/T00-bootstrap. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Scaffold the app in the CURRENT repo root (it already has docs, AGENTS.md, .env.example, .gitignore, LICENSE. Don't overwrite them).
1. `npx create-next-app@latest . --ts --eslint --tailwind --app --src-dir --import-alias "@/*" --use-npm` (if it refuses because the dir isn't empty, scaffold into /tmp/pp and copy files over without clobbering existing docs).
2. Add dev deps: vitest, tsx, drizzle-kit, @types/better-sqlite3, @playwright/test. Add deps: zod, drizzle-orm, better-sqlite3, server-only, sharp, exifr, ai, @ai-sdk/google, @ai-sdk/openai.
3. package.json scripts exactly as in docs/DIRECTORY_TREE.md; `engines.node >=20`.
4. vitest.config.ts (node env, include tests/unit/**/*.test.ts, alias @ → src).
5. Create the folder skeleton from AGENTS.md §3 with .gitkeep files. Add `src/app/api/health/route.ts` returning {ok:true, mockVision, paypalEnv}.
6. `.github/workflows/ci.yml`: on PR + push to main, Node 20, `npm ci`, `npm run check`, plus the secret-grep step from MANUAL §14.
7. Add one trivial unit test so `npm test` runs.
Done when `npm run check && npm run build` pass.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
npm ci && npm run lint && npm run typecheck && npm test && npm run build pass; scripts dev/build/start/lint/typecheck/test/db:reset/eval exist; .github/workflows/ci.yml runs them; LICENSE, .gitignore, .env.example committed; folder skeleton from docs/DIRECTORY_TREE.md exists with .gitkeep files.

RULES
- Make a 5-10 line plan first, then implement in small commits "T00: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T00] Repo bootstrap: Next.js+TS scaffold, tooling, scripts, CI" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T00 → In review; Branch=feat/T00-bootstrap; PR=<url>
```

## T01

**Shared contracts: zod schemas + escrow transition table (src/shared/*)** · Owner: Adarsh · Lane: **Backend lane** · Slot: Tue 14:00–16:00 · Est: 0.75 h · Depends on: T00 · Branch: `feat/T01-contracts`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T01: Shared contracts: zod schemas + escrow transition table (src/shared/*).
Branch: feat/T01-contracts. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Create src/shared/contracts.ts, src/shared/escrow.ts and src/shared/money.ts. They must be isomorphic: NO node imports.
- Translate every type in docs/MANUAL.md §8 (Types + SettlementProposal + error shape) and §9.2 (VerificationReportSchema, Box, CriterionVerdict) and §9.3 (ForensicsReport) and §9.4 (Decision) into zod schemas, exporting both `XSchema` and `type X = z.infer<…>`.
- Request body schemas for every endpoint in §8 (CreateJobBody, UpdateCriteriaBody, CreateOrderBody, AuthorizeBody, SubmitBody, AcceptBody, DeclineBody, ReviewBody, VoidBody, RefundBody).
- escrow.ts: ESCROW_STATUSES, EscrowStatus, TRANSITIONS (copy MANUAL §7 exactly), TERMINAL set, canTransition(from,to).
- money.ts: toCents("12.34")→1234, fromCents(1234)→"12.34", floorToStep(cents, step=0.05 of total), all integer maths.
- tests/unit/shared/*.test.ts: every allowed transition true, 3 illegal false; money round-trips incl. "0.10", "99.99".
After merge this is FROZEN. Note that in the PR description.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
src/shared/contracts.ts exports every type in MANUAL §8 and §9.2 (Money, Criterion, Job, PaymentSummary, EventItem, VerificationReportSchema, ForensicsReport, Decision, SettlementProposal, ApiError); src/shared/escrow.ts exports ESCROW_STATUSES, TRANSITIONS, canTransition(); unit tests cover every allowed and 3 illegal transitions. FROZEN after merge (contract-change label required).

RULES
- Make a 5-10 line plan first, then implement in small commits "T01: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T01] Shared contracts: zod schemas + escrow transition table (src/shared/*)" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T01 → In review; Branch=feat/T01-contracts; PR=<url>
```

## T02

**DB schema (Drizzle + better-sqlite3), repositories, seed script** · Owner: Adarsh · Lane: **Backend lane** · Slot: Tue 16:00–19:00 · Est: 1.0 h · Depends on: T01 · Branch: `feat/T02-db`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T02: DB schema (Drizzle + better-sqlite3), repositories, seed script.
Branch: feat/T02-db. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/db/{schema.ts,client.ts,repo.ts,seed.ts} and scripts/db-reset.ts with Drizzle + better-sqlite3, exactly following docs/MANUAL.md §6.
- client.ts: singleton DB at env DATABASE_PATH (mkdir -p dirname), WAL mode.
- repo.ts: createJob, getJob (joins criteria, payment, latest verification, events → returns shared `Job` shape), listJobs, replaceCriteria, upsertPayment, insertEvidence, listEvidence(jobId|all), insertVerification, insertEvent, setStatus (internal; only machine.ts will call it).
- seed.ts: 3 demo jobs in CREATED (bike chain $60, apartment cleaning $120, parcel delivery $45) with template criteria.
- db-reset.ts: delete db + UPLOAD_DIR contents, migrate (drizzle-kit generate output in drizzle/), seed.
- Unit tests with an in-memory DB (`:memory:`).

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
src/server/db/schema.ts matches MANUAL §6; npm run db:reset creates ./data/proofpay.db and seeds 3 demo jobs (bike, cleaning, delivery) in CREATED; repo functions getJob/listJobs/insertEvent/updateStatus typed; unit test with in-memory db.

RULES
- Make a 5-10 line plan first, then implement in small commits "T02: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T02] DB schema (Drizzle + better-sqlite3), repositories, seed script" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T02 → In review; Branch=feat/T02-db; PR=<url>
```

## T03

**PayPal REST client: OAuth token cache, ppFetch, PayPal-Request-Id, error mapping** · Owner: Adarsh · Lane: **Backend lane** · Slot: Tue 16:00–19:00 · Est: 1.0 h · Depends on: T00 · Branch: `feat/T03-paypal-client`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T03: PayPal REST client: OAuth token cache, ppFetch, PayPal-Request-Id, error mapping.
Branch: feat/T03-paypal-client. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/env.ts (zod env per AGENTS.md §7; throw if PAYPAL_API_BASE is not the sandbox host) and src/server/paypal/{client.ts,errors.ts}.
- getAccessToken(): POST {base}/v1/oauth2/token, Basic base64(id:secret), body grant_type=client_credentials; cache in module memory until expires_in-60s.
- ppFetch<T>(path, {method, body, idempotencyKey?, prefer='return=representation', schema?}): JSON; capture `paypal-debug-id` header; on non-2xx parse {name, message, details[{issue,description}], debug_id} → throw PayPalError {status, name, issue, description, debugId}.
- 204 handling (void returns no body).
- tests/unit/server/paypal/client.test.ts with mocked global fetch: token caching, header presence, error mapping, 204.
- scripts/paypal-smoke.ts prints only "PayPal sandbox token OK (expires in Ns)". Never print the token.
Docs: https://developer.paypal.com/docs/api/orders/v2/ and docs/REFERENCES.md.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
src/server/paypal/client.ts: getAccessToken caches until expiry-60s; ppFetch sets Bearer, Prefer: return=representation, PayPal-Request-Id; PayPalError(status, issue, debugId); unit tests with mocked fetch; scripts/paypal-smoke.ts gets a sandbox token (run manually).

RULES
- Make a 5-10 line plan first, then implement in small commits "T03: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T03] PayPal REST client: OAuth token cache, ppFetch, PayPal-Request-Id, error mapping" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T03 → In review; Branch=feat/T03-paypal-client; PR=<url>
```

## T04

**Orders v2: create (intent AUTHORIZE) + authorize + get; API endpoints 5–6** · Owner: Adarsh · Lane: **Backend lane** · Slot: Tue 20:30–23:00 · Est: 1.0 h · Depends on: T02, T03 · Branch: `feat/T04-orders-authorize`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T04: Orders v2: create (intent AUTHORIZE) + authorize + get; API endpoints 5–6.
Branch: feat/T04-orders-authorize. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/paypal/orders.ts and routes src/app/api/paypal/orders/route.ts + src/app/api/paypal/orders/[orderId]/authorize/route.ts per docs/MANUAL.md §8 (#5, #6) and §10.3.
- createOrder(job): body {intent:"AUTHORIZE", purchase_units:[{reference_id:job.id, custom_id:job.id, description:title (≤127 chars), amount:{currency_code, value}}]}, idempotency key `${jobId}:create:1`.
- authorizeOrder(orderId, jobId): POST /v2/checkout/orders/{id}/authorize {} → read purchase_units[0].payments.authorizations[0] {id,status,expiration_time}; store via upsertPayment; honor_period_ends_at = now+3d; generate 4-digit liveness code (crypto.randomInt), update criterion cL label; transition CREATED→AUTHORIZED. (If T06 isn't merged yet, put a minimal transition in machine.ts behind a TODO; coordinate with T06.)
- Validate that jobId matches order.purchase_units[0].custom_id (GET order) before authorizing.
- Manually test in the sandbox: run the dev server, use curl to create the order, approve it via the approve link in the order response with the sandbox buyer, then call authorize. Paste the IDs in the PR.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
POST /api/paypal/orders returns orderId from sandbox; POST /api/paypal/orders/:id/authorize stores authorization id, status, expiration_time, honor_period_ends_at, generates 4-digit liveness code, moves job to AUTHORIZED; manual sandbox test logged in PR with order id and authorization id.

RULES
- Make a 5-10 line plan first, then implement in small commits "T04: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T04] Orders v2: create (intent AUTHORIZE) + authorize + get; API endpoints 5–6" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T04 → In review; Branch=feat/T04-orders-authorize; PR=<url>
```

## T05

**Payments v2: capture full/partial (final_capture), void, refund, reauthorize, get auth** · Owner: Adarsh · Lane: **Backend lane** · Slot: Wed 09:00–13:00 · Est: 1.0 h · Depends on: T03 · Branch: `feat/T05-payments-ops`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T05: Payments v2: capture full/partial (final_capture), void, refund, reauthorize, get auth.
Branch: feat/T05-payments-ops. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/paypal/payments.ts and src/server/escrow/idempotency.ts per docs/MANUAL.md §10.3.
Functions: captureAuthorization(authId, {amountCents?, currency, finalCapture=true, invoiceId, noteToPayer}), voidAuthorization(authId), reauthorize(authId, amount?), refundCapture(captureId, {amountCents?, note}), getAuthorization(authId).
- PayPal-Request-Id = sha256(`${jobId}:${op}:${attempt}`) persisted in paypal_idempotency (return the stored response on replay).
- Map 422 issues to friendly messages (AUTHORIZATION_EXPIRED, AUTHORIZATION_VOIDED, AUTHORIZATION_ALREADY_CAPTURED, MAX_CAPTURE_AMOUNT_EXCEEDED, DUPLICATE_INVOICE_ID, PREVIOUSLY_CAPTURED, PREVIOUSLY_VOIDED, CANNOT_BE_VOIDED). Treat names as "verify".
- Unit tests with mocked ppFetch.
- SANDBOX EXPERIMENT (required, record the results in docs/REFERENCES.md verification log via a docs commit in this PR): authorize $100 → capture $80 with final_capture:true → GET authorization: what's the status and is the remainder released? Then try void on it: what's the error?

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
src/server/paypal/payments.ts exports captureAuthorization(authId,{amount?,finalCapture:true,invoiceId}), voidAuthorization, refundCapture, reauthorize, getAuthorization; idempotency rows in paypal_idempotency; sandbox test notes in PR: partial capture of 80% then GET authorization shows remaining released (record actual behaviour in docs/REFERENCES.md).

RULES
- Make a 5-10 line plan first, then implement in small commits "T05: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T05] Payments v2: capture full/partial (final_capture), void, refund, reauthorize, get auth" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T05 → In review; Branch=feat/T05-payments-ops; PR=<url>
```

## T06

**Escrow state machine + settle.ts (PayPal side effects before transitions)** · Owner: Adarsh · Lane: **Backend lane** · Slot: Wed 09:00–13:00 · Est: 1.5 h · Depends on: T02, T05 · Branch: `feat/T06-escrow`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T06: Escrow state machine + settle.ts (PayPal side effects before transitions).
Branch: feat/T06-escrow. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/escrow/machine.ts and settle.ts per docs/MANUAL.md §7.
- transition(jobId, to, actor, data): in ONE better-sqlite3 transaction: read the current status, check canTransition (from src/shared/escrow.ts), else throw IllegalTransition(from,to); setStatus; insertEvent STATUS_CHANGED.
- settle(jobId, decision | action): FULL → captureAuthorization(final) → CAPTURED; PARTIAL (requires an existing event type='REVIEW' or 'SETTLEMENT_ACCEPTED' by customer/reviewer, else throw PolicyError) → capture amount final → CAPTURED; VOID → voidAuthorization → VOIDED; REFUND → refundCapture → REFUNDED. PayPal call FIRST, then transition; on PayPalError log a PAYPAL_CALL event with the error and rethrow.
- AUTO_CAPTURE_ON_APPROVE honoured by an exported onApproved(jobId).
- Update payments row (captured_cents, capture_ids, voided_at, refunded_cents).
- Tests: every path with mocked payments.ts; illegal transition; partial without approval rejected.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
transition() atomic with events row; IllegalTransition -> 409; settle(job, decision) does capture/partial/void; AUTO_CAPTURE_ON_APPROVE honoured; PARTIAL capture requires customer accept event; tests cover each path with mocked PayPal.

RULES
- Make a 5-10 line plan first, then implement in small commits "T06: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T06] Escrow state machine + settle.ts (PayPal side effects before transitions)" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T06 → In review; Branch=feat/T06-escrow; PR=<url>
```

## T07

**Job + evidence API routes (endpoints 1–4, 7–9, 11–15, 17, 20, 21) with withErrors()** · Owner: Adarsh · Lane: **Backend lane** · Slot: Wed 09:00–13:00 · Est: 1.5 h · Depends on: T06, T09 · Branch: `feat/T07-api-routes`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T07: Job + evidence API routes (endpoints 1–4, 7–9, 11–15, 17, 20, 21) with withErrors().
Branch: feat/T07-api-routes. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement the remaining API routes listed in docs/MANUAL.md §8 (#1–4, 7–9, 11–15, 17, 20, 21) under src/app/api/** plus src/server/http/{with-errors.ts,role.ts,errors.ts}.
- withErrors maps ZodError→400, NotFound→404, IllegalTransition→409, PolicyError→403, PayPalError→502 {code:issue, message, details:{debugId}}, else 500. Error body {error:{code,message,details?}}.
- role.ts: read cookie pp_role; requireRole(req, ...roles) → 403. A page/route `/?as=` sets the cookie (the Frontend lane builds the page; you provide `src/app/api/role/route.ts` POST {role} that sets the cookie, documented in docs/API_EXAMPLES.md).
- Evidence upload: request.formData(); ≤4 files/phase, ≤8MB; ingestImage from T09; filenames server-generated.
- POST submit returns 202 and kicks off orchestrator (T13) with `void runVerification(jobId)` (stub if T13 isn't merged: set VERIFYING and log).
- uploads route: path-traversal guard (resolve + startsWith UPLOAD_DIR), re-encoded image without GPS.
- docs/API_EXAMPLES.md with a curl for each route (docs-only commit in this PR is fine).

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
All routes in MANUAL §8 respond with documented shapes (zod-validated); upload limits enforced; role cookie checked; route tests via vitest + next test helpers or supertest-like handler calls; curl examples in docs/API_EXAMPLES.md.

RULES
- Make a 5-10 line plan first, then implement in small commits "T07: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T07] Job + evidence API routes (endpoints 1–4, 7–9, 11–15, 17, 20, 21) with withErrors()" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T07 → In review; Branch=feat/T07-api-routes; PR=<url>
```

## T08

**Criteria generator (LLM generateObject) + category fallback templates + liveness criterion** · Owner: Adarsh · Lane: **Backend lane** · Slot: Tue 20:30–23:00 · Est: 1.0 h · Depends on: T01 · Branch: `feat/T08-criteria`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T08: Criteria generator (LLM generateObject) + category fallback templates + liveness criterion.
Branch: feat/T08-criteria. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/vision/{criteria.ts,criteria-templates.ts,prompts.ts (CRITERIA_SYSTEM_PROMPT)} and src/server/ai.ts (model factory: AI_PROVIDER google|openai → AI SDK model for LLM_MODEL/VLM_MODEL).
- generateCriteria(job): generateObject({model, schema: CriteriaDraftSchema (3–6 items), system: CRITERIA_SYSTEM_PROMPT from MANUAL §9.1, prompt: job fields, temperature:0.2}) with AbortSignal timeout 20s.
- Normalise weights to sum 1 (required ones keep ≥0.1); ids c1..cN; append system liveness criterion cL (weight 0, required, source 'system').
- Fallback to the category template on error/timeout or when VISION_MOCK=1.
- Tests: normalisation, fallback, liveness always present. Mock the AI SDK.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
generateCriteria(job) returns 3–6 criteria, weights sum 1±0.001, plus system cL liveness criterion; timeout 20s -> template; VISION_MOCK=1 returns template without network; tests for normalisation + fallback.

RULES
- Make a 5-10 line plan first, then implement in small commits "T08: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T08] Criteria generator (LLM generateObject) + category fallback templates + liveness criterion" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T08 → In review; Branch=feat/T08-criteria; PR=<url>
```

## T09

**Evidence ingest: sharp resize, sha256, dHash, exifr EXIF; store under UPLOAD_DIR** · Owner: Adarsh · Lane: **Backend lane** · Slot: Tue 16:00–19:00 · Est: 1.0 h · Depends on: T02 · Branch: `feat/T09-evidence-ingest`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T09: Evidence ingest: sharp resize, sha256, dHash, exifr EXIF; store under UPLOAD_DIR.
Branch: feat/T09-evidence-ingest. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/vision/{ingest.ts,dhash.ts}.
- ingestImage(buf, {jobId, phase}): sharp(buf).metadata() must be jpeg|png|webp else throw ValidationError; `rotate()` (auto-orient), resize longest side to 1536, jpeg q85 → store at UPLOAD_DIR/<jobId>/<phase>_<n>.jpg; sha256 of ORIGINAL bytes; dhash of the stored image; exifr.parse(original,{pick:['DateTimeOriginal','CreateDate','Make','Model']}) → exifTakenAt ISO or null; return EvidenceItem fields.
- dhash(buf): grayscale, resize 9x8 fill, compare adjacent pixels row-wise → 64-bit → 16 hex chars. hamming(a,b).
- Tests: same image re-encoded at q60 → hamming ≤6; two different eval images → ≥20 (use 2 small fixture images in tests/unit/fixtures/, your own photos or generated noise/gradients).

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
ingestImage(buffer) -> {sha256,dhash(16 hex),width,height,exifTakenAt?,storedPath}; rejects non-image by sharp metadata; dHash identical for re-encoded copy (hamming<=6) and different for unrelated images (>=20) in tests using eval sample images.

RULES
- Make a 5-10 line plan first, then implement in small commits "T09: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T09] Evidence ingest: sharp resize, sha256, dHash, exifr EXIF; store under UPLOAD_DIR" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T09 → In review; Branch=feat/T09-evidence-ingest; PR=<url>
```

## T10

**Forensics checks (duplicates, before≈after, EXIF window, scene/screenshot flags)** · Owner: Adarsh · Lane: **Backend lane** · Slot: Wed 09:00–13:00 · Est: 1.0 h · Depends on: T09 · Branch: `feat/T10-forensics`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T10: Forensics checks (duplicates, before≈after, EXIF window, scene/screenshot flags).
Branch: feat/T10-forensics. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/vision/forensics.ts exactly per docs/MANUAL.md §9.3.
runForensics({job, evidence, otherEvidence, stockHashes, authorizedAt, vlm?}) → ForensicsReport.
- EXACT_DUPLICATE (sha256), NEAR_DUPLICATE (hamming ≤6 vs other jobs or eval/stock), NO_CHANGE (best before/after hamming ≤4: MEDIUM), EXIF_BEFORE_AUTH (after-photo taken < authorizedAt-10min: HIGH), EXIF_MISSING (INFO), SCENE_MISMATCH (vlm.sameScene DIFFERENT conf≥0.7: HIGH), SCREENSHOT (MEDIUM).
- loadStockHashes(): compute dhash for eval/stock/* once (cache).
- Table-driven tests for each flag.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
runForensics(job, evidence, vlmReport?) -> ForensicsReport per MANUAL §9.3 table; compares against other jobs and eval/stock; unit tests for each flag.

RULES
- Make a 5-10 line plan first, then implement in small commits "T10: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T10] Forensics checks (duplicates, before≈after, EXIF window, scene/screenshot flags)" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T10 → In review; Branch=feat/T10-forensics; PR=<url>
```

## T11

**VLM verifier (generateObject, image labelling, retry-on-invalid, mock fixtures)** · Owner: Adarsh · Lane: **Backend lane** · Slot: Tue 20:30–23:00 · Est: 1.5 h · Depends on: T01, T09 · Branch: `feat/T11-vlm-verify`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T11: VLM verifier (generateObject, image labelling, retry-on-invalid, mock fixtures).
Branch: feat/T11-vlm-verify. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/vision/{verify.ts,mock.ts} and add VERIFY_SYSTEM_PROMPT to prompts.ts (copy verbatim from docs/MANUAL.md §9.2, including the prompt-injection rule).
- verifyEvidence({criteria, before[], after[], livenessCode}) → VerificationReport: build a multimodal message: text block listing criteria JSON, then for each image a text label "Image B1:" followed by the image part (stored jpeg buffer). generateObject with VerificationReportSchema, temperature 0, AbortSignal VLM_TIMEOUT_MS.
- On schema failure retry once, appending the zod issues; second failure → throw VlmInvalidOutput.
- Post-validate: every criterionId present (missing → NOT_VISIBLE conf 0), boxes clamped to 0..1000, imageIds exist.
- mock.ts: if VISION_MOCK=1 read eval/fixtures/<sha256 of first after image>.json, else a category default fixture in eval/fixtures/default-<category>.json (create 4 defaults).
- Manually run on 3 eval pairs (script call or a test marked .skip by default) and paste the outputs (trimmed) in the PR. Check the box_2d convention for your provider (often [ymin, xmin, ymax, xmax] / 1000; verify).

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
verifyEvidence() returns VerificationReport (zod) with boxes; prompt exactly as MANUAL §9.2 in src/server/vision/prompts.ts; one retry on zod failure; VISION_MOCK reads eval/fixtures; manual run on 3 eval pairs pasted in PR.

RULES
- Make a 5-10 line plan first, then implement in small commits "T11: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T11] VLM verifier (generateObject, image labelling, retry-on-invalid, mock fixtures)" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T11 → In review; Branch=feat/T11-vlm-verify; PR=<url>
```

## T12

**Decision engine (pure) + thresholds from env** · Owner: Collaborator · Lane: **Backend lane** · Slot: Wed 09:00–13:00 · Est: 0.75 h · Depends on: T01 · Branch: `feat/T12-decide`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T12: Decision engine (pure) + thresholds from env.
Branch: feat/T12-decide. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/vision/decide.ts: a PURE function decide({criteria, report, forensics, amountCents, currency, thresholds}) → Decision, exactly the pseudo-code in docs/MANUAL.md §9.4. Read thresholds from env via a small getThresholds() in src/server/env.ts (coordinate: if env.ts exists, only add fields).
- Partial amount: floorToStep(score) with PARTIAL_ROUND_TO, using src/shared/money.ts integer maths. Never exceed amountCents.
- reasons[]: human-readable strings referencing criterion ids and flag codes.
- ≥12 table-driven tests: all pass → APPROVED; 4/5 pass → PARTIAL 80%; liveness missing confident → REJECTED; liveness NOT_VISIBLE → HUMAN_REVIEW; HIGH flag overrides pass → HUMAN_REVIEW; MEDIUM flag + pass → PARTIAL/HUMAN_REVIEW per spec; low confidence; score < T_PARTIAL → REJECTED; rounding edge cases.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
decide(criteria, report, forensics, amount) implements MANUAL §9.4 exactly; >=12 table-driven unit tests incl. liveness missing, HIGH flag, partial rounding (floor to 0.05).

RULES
- Make a 5-10 line plan first, then implement in small commits "T12: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T12] Decision engine (pure) + thresholds from env" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T12 → In review; Branch=feat/T12-decide; PR=<url>
```

## T13

**Verification orchestrator: submit -> VERIFYING -> forensics+VLM -> decide -> settle/agent** · Owner: Adarsh · Lane: **Backend lane** · Slot: Wed 14:00–18:00 · Est: 1.0 h · Depends on: T06, T10, T11, T12 · Branch: `feat/T13-orchestrator`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T13: Verification orchestrator: submit -> VERIFYING -> forensics+VLM -> decide -> settle/agent.
Branch: feat/T13-orchestrator. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/vision/orchestrator.ts: runVerification(jobId).
Flow: transition EVIDENCE_SUBMITTED→VERIFYING → load criteria/evidence → verifyEvidence (or mock) → runForensics (with vlm) → decide → insertVerification → transition to outcome → if APPROVED && AUTO_CAPTURE_ON_APPROVE: settle FULL; if PARTIAL/REJECTED/HUMAN_REVIEW: call runSettlementAgent(jobId) if available (T14), else write a template proposal event. Any thrown error → HUMAN_REVIEW with reason event.
- Guard against double-run (if status != EVIDENCE_SUBMITTED, return).
- Wire into POST /api/jobs/:id/submit and /verify (reviewer force re-run).
- Test with mocks: approved path auto-captures; VLM failure → HUMAN_REVIEW.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
POST /api/jobs/:id/submit returns 202 and verification completes in-process; verifications row stored; outcome transitions correct; APPROVED auto-captures in sandbox; errors -> HUMAN_REVIEW with reason.

RULES
- Make a 5-10 line plan first, then implement in small commits "T13: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T13] Verification orchestrator: submit -> VERIFYING -> forensics+VLM -> decide -> settle/agent" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T13 → In review; Branch=feat/T13-orchestrator; PR=<url>
```

## T14

**Settlement agent v1 (AI SDK tools, policy gate, proposals, evidence pack markdown, PayPal Agent Toolkit read tools)** · Owner: Adarsh · Lane: **Backend lane** · Slot: Wed 14:00–18:00 · Est: 2.0 h · Depends on: T13 · Branch: `feat/T14-agent`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T14: Settlement agent v1 (AI SDK tools, policy gate, proposals, evidence pack markdown, PayPal Agent Toolkit read tools).
Branch: feat/T14-agent. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/agent/{settlement-agent.ts,tools.ts,policy.ts,evidence-pack.ts} per docs/MANUAL.md §11.
- runSettlementAgent(jobId): AI SDK generateText({model, system: SETTLEMENT_SYSTEM_PROMPT, tools, maxSteps:6}). Tools (zod params): get_job, get_verification, propose_settlement, request_more_evidence (stretch: just writes an event), escalate_to_human, draft_evidence_pack.
- Merge PayPal Agent Toolkit read tools: `new PayPalAgentToolkit({clientId, clientSecret, configuration:{actions:{orders:{get:true}, disputes:{list:true,get:true}}}})` from '@paypal/agent-toolkit/ai-sdk'. Verify the action key names in the package README; if they differ, adapt and note it in the PR.
- policy.ts: assertCanCapture(jobId, amount) requires a SETTLEMENT_ACCEPTED (customer) or REVIEW (reviewer) event and amount ≤ decision.captureAmount ≤ authorized; assertCanRefund requires a reviewer event. Unit-test these.
- propose_settlement can't exceed decision.captureAmount (clamp + log).
- evidence-pack.ts: deterministic Markdown (job, criteria table, verdicts + boxes, forensics, EXIF, timeline, PayPal IDs incl. get_order status). Route #18.
- VISION_MOCK=1 → no LLM: deterministic template explanation from the decision.reasons.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
runSettlementAgent(jobId) writes SettlementProposal event for PARTIAL with explanation citing criterion ids; money tools refuse without approval event (unit-tested); evidence-pack endpoint returns markdown; Agent Toolkit get_order used to show order state in pack; mock mode deterministic.

RULES
- Make a 5-10 line plan first, then implement in small commits "T14: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T14] Settlement agent v1 (AI SDK tools, policy gate, proposals, evidence pack markdown, PayPal Agent Toolkit read tools)" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T14 → In review; Branch=feat/T14-agent; PR=<url>
```

## T15

**Render deploy: render.yaml, health check, SEED_ON_BOOT, env vars; hosted URL in README** · Owner: Collaborator · Lane: **Backend lane** · Slot: Wed 19:30–23:30 · Est: 0.75 h · Depends on: T13 · Branch: `feat/T15-render`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T15: Render deploy: render.yaml, health check, SEED_ON_BOOT, env vars; hosted URL in README.
Branch: feat/T15-render. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Create render.yaml (start from docs/DIRECTORY_TREE.md; verify keys at https://render.com/docs/blueprint-spec) and scripts/start.mjs (if SEED_ON_BOOT=1 run db-reset, then `next start -p ${PORT:-3000}`).
- Deploy: Render dashboard → New → Blueprint → repo adarsh-nl/proofpay. Set secret env vars in the dashboard (never in yaml). Note: NEXT_PUBLIC_PAYPAL_CLIENT_ID is inlined at build time.
- Confirm /api/health returns 200, then run the happy path on the hosted URL with the sandbox buyer.
- Update README "Hosted demo" with the URL (docs commit in this PR).
- If better-sqlite3/sharp native builds fail on Render, record the error and fix (e.g. Node version pin via `engines` or the NODE_VERSION env var; verify).

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
render.yaml blueprint (web service, node, build npm ci && npm run build, start npm start, healthCheckPath /api/health); deployed URL loads and runs happy path in sandbox; README updated with URL. This is the Render sponsor submission, alongside the AG Grid ledger (F09).

RULES
- Make a 5-10 line plan first, then implement in small commits "T15: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T15] Render deploy: render.yaml, health check, SEED_ON_BOOT, env vars; hosted URL in README" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T15 → In review; Branch=feat/T15-render; PR=<url>
```

## T16

**STRETCH: PayPal webhooks route with signature verification** · Owner: Adarsh · Lane: **Backend lane** · Slot: Wed 19:30–23:30 · Est: 1.0 h · Depends on: T15 · Branch: `feat/T16-webhooks`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T16: STRETCH: PayPal webhooks route with signature verification.
Branch: feat/T16-webhooks. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/paypal/webhooks.ts + src/app/api/webhooks/paypal/route.ts per docs/MANUAL.md §10.4. Read the raw text body, collect headers paypal-auth-algo, paypal-cert-url, paypal-transmission-id, paypal-transmission-sig, paypal-transmission-time; POST /v1/notifications/verify-webhook-signature with webhook_id=PAYPAL_WEBHOOK_ID and webhook_event=JSON.parse(body); accept only verification_status==="SUCCESS" (else 400). Log a WEBHOOK event, refresh the authorization via GET. Never change escrow state from a webhook in the MVP. Register the webhook on the Render URL in the sandbox app; trigger it with a real sandbox capture.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
POST /api/webhooks/paypal verifies via /v1/notifications/verify-webhook-signature; rejects on failure (400); logs WEBHOOK event; tested with sandbox webhook to Render URL.

RULES
- Make a 5-10 line plan first, then implement in small commits "T16: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T16] STRETCH: PayPal webhooks route with signature verification" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T16 → In review; Branch=feat/T16-webhooks; PR=<url>
```

## T17

**STRETCH: Reauthorize button + honor-period countdown** · Owner: Adarsh · Lane: **Backend lane** · Slot: Wed 19:30–23:30 · Est: 0.75 h · Depends on: T05, F06 · Branch: `feat/T17-reauthorize`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T17: STRETCH: Reauthorize button + honor-period countdown.
Branch: feat/T17-reauthorize. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement POST /api/jobs/:id/reauthorize using payments.reauthorize; replace authorization_id, reset honor_period_ends_at. Expect an error when the original authorization is still inside its honor period (verify) and surface it nicely. Expose honorPeriodEndsAt in PaymentSummary (already in contracts). The UI countdown is a separate Frontend lane change: describe the needed component in the hand-off.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
Endpoint 16 works or shows the PayPal error gracefully; UI countdown to honor_period_ends_at.

RULES
- Make a 5-10 line plan first, then implement in small commits "T17: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T17] STRETCH: Reauthorize button + honor-period countdown" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T17 → In review; Branch=feat/T17-reauthorize; PR=<url>
```

## T18

**STRETCH: Payouts to worker after capture (simulated)** · Owner: Adarsh · Lane: **Backend lane** · Slot: Wed 19:30–23:30 · Est: 1.0 h · Depends on: T13 · Branch: `feat/T18-payouts`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task T18: STRETCH: Payouts to worker after capture (simulated).
Branch: feat/T18-payouts. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Implement src/server/paypal/payouts.ts: createPayout({receiverEmail, amount, note, senderBatchId=jobId}) → POST /v1/payments/payouts {sender_batch_header:{sender_batch_id, email_subject}, items:[{recipient_type:"EMAIL", amount:{value,currency}, receiver, note, sender_item_id}]}. Called after CAPTURED when PAYOUTS_ENABLED=1, for the worker sandbox email (add a WORKER_SANDBOX_EMAIL env). Log the payout_batch_id in events. First verify that Payouts works on our sandbox app; if it's not enabled, stop and report.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
After CAPTURED, optional POST /v1/payments/payouts to worker sandbox email; payout batch id in timeline; behind PAYOUTS_ENABLED=1.

RULES
- Make a 5-10 line plan first, then implement in small commits "T18: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[T18] STRETCH: Payouts to worker after capture (simulated)" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: T18 → In review; Branch=feat/T18-payouts; PR=<url>
```

## F01

**App shell: layout, role switcher (?as=), nav, theme, shadcn setup, landing page with origin story** · Owner: Collaborator · Lane: **Frontend lane** · Slot: Tue 14:00–16:00 · Est: 1.0 h · Depends on: T00 · Branch: `feat/F01-app-shell`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task F01: App shell: layout, role switcher (?as=), nav, theme, shadcn setup, landing page with origin story.
Branch: feat/F01-app-shell. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Build the app shell with shadcn/ui (`npx shadcn@latest init`, then add button card badge input textarea select dialog toast/sonner tabs table separator skeleton progress tooltip).
- src/app/layout.tsx: header (logo text "ProofPay", role badge, "PayPal Sandbox" badge, links: New job, My jobs, Reviewer), footer ("Sandbox demo. No real money moves.").
- src/app/page.tsx landing: hero "Money moves when the camera says the job is done.", 3-step explainer (Hold with PayPal → Prove with photos → AI verifies → Capture), origin story card (the "delivered" parcel that never arrived), 3 role cards linking to `/?as=customer` etc. The role is set via POST /api/role {role} (the Backend lane provides it); until then set the `pp_role` cookie client-side in src/lib/role.ts.
- src/lib/format.ts formatMoney(Money), formatDate.
- Responsive at 390px. Screenshot in PR.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
/ shows pitch + 3 role cards; ?as=customer|worker|reviewer sets pp_role cookie; header shows current role + 'Sandbox' badge; mobile responsive; Lighthouse a11y >= 90 on landing.

RULES
- Make a 5-10 line plan first, then implement in small commits "F01: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[F01] App shell: layout, role switcher (?as=), nav, theme, shadcn setup, landing page with origin story" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: F01 → In review; Branch=feat/F01-app-shell; PR=<url>
```

## F02

**Customer: create job form + editable criteria preview** · Owner: Collaborator · Lane: **Frontend lane** · Slot: Tue 16:00–19:00 · Est: 1.5 h · Depends on: F01, T01 · Branch: `feat/F02-create-job`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task F02: Customer: create job form + editable criteria preview.
Branch: feat/F02-create-job. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Build src/app/customer/new/page.tsx and src/components/job/{CreateJobForm.tsx,CriteriaEditor.tsx}.
- Form: title, description (textarea), category select (cleaning, bike_repair, assembly, delivery, other), amount (USD). Validate with CreateJobBody from @/shared/contracts (zod) client-side.
- Submit → api-client.createJob() → redirect /jobs/[id].
- CriteriaEditor (on /jobs/[id] while status CREATED): rows with label, howToVerify (collapsible), required toggle, weight slider; live total "Weights: 100%"; liveness criterion cL shown locked with a lock icon; Save → PUT criteria.
- src/lib/api-client.ts: typed wrappers for ALL endpoints in MANUAL §8 (parse responses with zod schemas). Until T07 merges, a `NEXT_PUBLIC_USE_FIXTURES=1` switch returns src/lib/fixtures/*.json.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
/customer/new form (title, description, category, amount) posts to /api/jobs (use src/lib/api-client.ts typed with contracts; mock with MSW or fixture until T07 lands); criteria list editable (label, required, weight) with live weight total; liveness criterion locked.

RULES
- Make a 5-10 line plan first, then implement in small commits "F02: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[F02] Customer: create job form + editable criteria preview" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: F02 → In review; Branch=feat/F02-create-job; PR=<url>
```

## F03

**PayPal Buttons checkout (intent=authorize) on job page** · Owner: Collaborator · Lane: **Frontend lane** · Slot: Wed 09:00–13:00 · Est: 1.0 h · Depends on: F02, T04 · Branch: `feat/F03-paypal-buttons`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task F03: PayPal Buttons checkout (intent=authorize) on job page.
Branch: feat/F03-paypal-buttons. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Add PayPal checkout to /jobs/[id] for status CREATED: `npm i @paypal/react-paypal-js`. <PayPalScriptProvider options={{clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID, intent: "authorize", currency: "USD"}}> + <PayPalButtons createOrder={() => api.createOrder(jobId).then(r=>r.orderId)} onApprove={({orderID}) => api.authorize(orderID, jobId)} onError=toast />. Verify prop names against the package README (option key may be `clientId` or `"client-id"` depending on version).
After success show a "Funds held by PayPal" card: amount, authorization id, "hold valid until <expiresAt>", "capture recommended before <honorPeriodEndsAt>". data-testid="paypal-buttons", "funds-held". Test with the sandbox personal account.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
@paypal/react-paypal-js (or SDK script) with intent=authorize&currency=USD; createOrder calls endpoint 5; onApprove calls endpoint 6; success shows 'Funds held' with authorization id and expiry; works with sandbox buyer login.

RULES
- Make a 5-10 line plan first, then implement in small commits "F03: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[F03] PayPal Buttons checkout (intent=authorize) on job page" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: F03 → In review; Branch=feat/F03-paypal-buttons; PR=<url>
```

## F04

**Worker: evidence upload (before/after, camera capture, previews, liveness code banner)** · Owner: Collaborator · Lane: **Frontend lane** · Slot: Wed 09:00–13:00 · Est: 1.5 h · Depends on: F01, T01 · Branch: `feat/F04-worker-upload`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task F04: Worker: evidence upload (before/after, camera capture, previews, liveness code banner).
Branch: feat/F04-worker-upload. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Build src/app/worker/jobs/[id]/page.tsx and src/components/evidence/{EvidenceDropzone.tsx,LivenessBanner.tsx}.
- Big banner: "Write **4821** on paper (or show it on a phone) and include it in at least one AFTER photo." (code from job.livenessCode; the worker role sees it).
- Two dropzones (Before / After): `<input type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment">`, drag-and-drop, thumbnails, remove (DELETE endpoint), max 4 each, client-side size check 8 MB.
- Show the checklist (criteria labels) as "What to photograph".
- Submit button (data-testid="submit-evidence") disabled until ≥1 after image → POST submit → redirect /jobs/[id] (result view).

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
/worker/jobs/[id]: two dropzones (before/after), capture=environment on mobile, thumbnails, remove; big banner 'Write code 4821 on paper and include it in an after photo'; Submit disabled until >=1 after image; calls endpoints 7–9.

RULES
- Make a 5-10 line plan first, then implement in small commits "F04: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[F04] Worker: evidence upload (before/after, camera capture, previews, liveness code banner)" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: F04 → In review; Branch=feat/F04-worker-upload; PR=<url>
```

## F05

**Verification result view: per-criterion cards + bounding-box overlay + forensics flags** · Owner: Collaborator · Lane: **Frontend lane** · Slot: Wed 14:00–18:00 · Est: 2.0 h · Depends on: F04, T01 · Branch: `feat/F05-result-view`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task F05: Verification result view: per-criterion cards + bounding-box overlay + forensics flags.
Branch: feat/F05-result-view. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Build src/components/verification/{EvidenceViewer.tsx,CriterionCard.tsx,FlagsPanel.tsx,VerificationSummary.tsx} and mount them on /jobs/[id] when latestVerification exists. Build against eval/fixtures/default-cleaning.json (or src/lib/fixtures/verification.json) first.
- EvidenceViewer: image (served by /api/uploads/...) with absolutely positioned boxes: top=ymin/1000*100%, left=xmin/1000*100%, height=(ymax-ymin)/10 %, width=(xmax-xmin)/10 %. Before/after tabs or side-by-side. Hovering a CriterionCard highlights its boxes (shared state).
- CriterionCard: label, verdict chip (PASS green / FAIL red / UNCERTAIN blue / NOT_VISIBLE grey, with text), confidence bar, rationale; data-testid="verdict-<id>".
- FlagsPanel: HIGH red, MEDIUM amber, INFO grey, with a plain-English message.
- VerificationSummary: outcome badge, score %, "Verified by AI (<model>)", "mock" badge if mock.
- Polling: while status is VERIFYING, refetch every 2s.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
Component <EvidenceViewer> draws box_2d [ymin,xmin,ymax,xmax]/1000 on images (scales with resize); <CriterionCard> shows verdict chip, confidence bar, rationale; hover card highlights boxes; flags panel (HIGH red, MEDIUM amber); built against eval fixture JSON first.

RULES
- Make a 5-10 line plan first, then implement in small commits "F05: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[F05] Verification result view: per-criterion cards + bounding-box overlay + forensics flags" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: F05 → In review; Branch=feat/F05-result-view; PR=<url>
```

## F06

**Money timeline + settlement panel (accept/decline partial, void, PayPal IDs)** · Owner: Collaborator · Lane: **Frontend lane** · Slot: Wed 14:00–18:00 · Est: 1.5 h · Depends on: F05, T06 · Branch: `feat/F06-timeline-settlement`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task F06: Money timeline + settlement panel (accept/decline partial, void, PayPal IDs).
Branch: feat/F06-timeline-settlement. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Build src/components/timeline/MoneyTimeline.tsx and src/components/job/SettlementPanel.tsx.
- MoneyTimeline from job.events + job.payment: steps like "Held $120 (PayPal authorization 1AB…)", "AI verified 4/5", "Captured $96 (capture 5KA…)", "Released $24", "Voided". Each PayPal ID links to the sandbox dashboard activity (https://www.sandbox.paypal.com/activity; verify) or just copies to the clipboard.
- SettlementPanel: shows the latest SettlementProposal (AGENT_MESSAGE event) with the explanation, amounts and buttons Accept (data-testid="accept-proposal") / Decline (reason dialog) → endpoints 11/12; for AUTHORIZED, a "Cancel & release hold" button → void.
- Colours per AGENTS.md §8.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
<MoneyTimeline> renders events (Held $120 -> Verified 4/5 -> Captured $96 -> Released $24) with PayPal order/auth/capture ids and sandbox links; agent proposal card with Accept/Decline calling endpoints 11–12; polling every 2s while VERIFYING.

RULES
- Make a 5-10 line plan first, then implement in small commits "F06: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[F06] Money timeline + settlement panel (accept/decline partial, void, PayPal IDs)" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: F06 → In review; Branch=feat/F06-timeline-settlement; PR=<url>
```

## F07

**Reviewer console: queue table, job detail, approve/partial/reject, evidence pack** · Owner: Collaborator · Lane: **Frontend lane** · Slot: Wed 19:30–23:30 · Est: 1.5 h · Depends on: F05, T07 · Branch: `feat/F07-reviewer`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task F07: Reviewer console: queue table, job detail, approve/partial/reject, evidence pack.
Branch: feat/F07-reviewer. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Build src/app/reviewer/page.tsx (queue table from GET /api/review-queue: title, amount, reason, age) and src/app/reviewer/jobs/[id]/page.tsx (reuse EvidenceViewer/CriterionCard/FlagsPanel/MoneyTimeline) with a decision form: Approve / Partial (amount input ≤ authorized) / Reject, plus notes → POST review. Button "Generate evidence pack" → POST agent/evidence-pack → render the markdown (react-markdown is OK, note the dependency) with Copy + Download .md. If REVIEWER_PASSCODE is set, prompt once and send it as header x-reviewer-passcode (coordinate the header name with the Backend lane in the hand-off).

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
/reviewer lists HUMAN_REVIEW jobs (endpoint 17); detail reuses F05; decision form posts endpoint 13; 'Generate evidence pack' shows markdown (endpoint 18) with copy/download; passcode prompt if REVIEWER_PASSCODE set.

RULES
- Make a 5-10 line plan first, then implement in small commits "F07: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[F07] Reviewer console: queue table, job detail, approve/partial/reject, evidence pack" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: F07 → In review; Branch=feat/F07-reviewer; PR=<url>
```

## F08

**Demo polish: empty/loading/error states, copy, favicon, OG image, screenshots for README** · Owner: Collaborator · Lane: **Frontend lane** · Slot: Thu 09:00–12:00 · Est: 1.0 h · Depends on: F06, F07 · Branch: `feat/F08-polish`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task F08: Demo polish: empty/loading/error states, copy, favicon, OG image, screenshots for README.
Branch: feat/F08-polish. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Polish pass across all pages: loading skeletons, empty states ("No jobs yet: create one"), error toasts, consistent copy that names PayPal and AI explicitly, favicon + OG image (public/), 390px check, keyboard focus states. Take README screenshots (landing, verification result with boxes, partial proposal, reviewer) into docs/img/ (docs-only commit) and add them to the README "Screenshots" section.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
No raw JSON visible to users; toasts for errors; consistent copy; README screenshots in docs/img/; all pages work at 390px width.

RULES
- Make a 5-10 line plan first, then implement in small commits "F08: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[F08] Demo polish: empty/loading/error states, copy, favicon, OG image, screenshots for README" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: F08 → In review; Branch=feat/F08-polish; PR=<url>
```

## F09

**AG Grid escrow/ledger dashboard (jobs, held/captured/released, flags)** · Owner: Collaborator · Lane: **Frontend lane** · Slot: Wed 19:30–23:30 · Est: 1.5 h · Depends on: F07 · Branch: `feat/F09-ag-grid`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task F09: AG Grid escrow/ledger dashboard (jobs, held/captured/released, flags).
Branch: feat/F09-ag-grid. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Required sponsor work, together with the Render deploy (T15). `npm i ag-grid-react ag-grid-community`. Build the reviewer escrow/ledger dashboard ("All jobs") with AG Grid Community: columns id, title, status (cell renderer chip), held, captured, released, flags count, updated; quick filter, sort, CSV export. Reference: https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate. Add "AG Grid" to README Built with.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
AG Grid Community grid is the escrow/ledger dashboard: every job with status, held, captured, and released amounts, and fraud flags; column filter and sort; ag-grid-react and ag-grid-community installed; named in README Built with and in the Devpost sponsor fields together with the Render deploy (T15).

RULES
- Make a 5-10 line plan first, then implement in small commits "F09: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[F09] AG Grid escrow/ledger dashboard (jobs, held/captured/released, flags)" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: F09 → In review; Branch=feat/F09-ag-grid; PR=<url>
```

## A01

**Eval dataset: shoot 12–20 before/after pairs + case.json labels (human-heavy)** · Owner: Adarsh · Lane: **QA lane** · Slot: Tue 20:30–23:00 + Wed 08:00–09:00 · Est: 2.0 h · Depends on: — · Branch: `feat/A01-eval-dataset`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task A01: Eval dataset: shoot 12–20 before/after pairs + case.json labels (human-heavy).
Branch: feat/A01-eval-dataset. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
(Human + agent.) Agent part: create eval/pairs/ skeleton folders from the table in docs/MANUAL.md §9.5 (01-desk-clean … 20-wrong-code), each with case.json {title, description, category, amount, livenessCode (random 4 digits), expected:{outcome, criteria?:{}}, notes}; create scripts/eval-validate.ts (zod schema for case.json; checks files exist; images ≤1600px else resizes in place with sharp; strips ALL EXIF incl. GPS by re-encoding with sharp (sharp drops metadata by default), but FIRST writes the parsed DateTimeOriginal into case.json as `exifTakenAt` so the timestamp check still has data). Add npm script eval:validate.
Human part (Adarsh): photograph each case (same angle before/after, sticky note with the code in the after photo), drop files in, run `npm run eval:validate`. Put 2 images in eval/stock/ (your own "doorstep parcel" shots) for duplicate tests. No faces or readable addresses.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
eval/pairs/NN-slug/{case.json,before_*.jpg,after_*.jpg} for >=12 cases from MANUAL §9.5 table; images <=1600px, no faces/PII; eval/stock has 2 images; case.json skeletons and scripts/eval-validate.ts exist and npm run eval:validate passes.

RULES
- Make a 5-10 line plan first, then implement in small commits "A01: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[A01] Eval dataset: shoot 12–20 before/after pairs + case.json labels (human-heavy)" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: A01 → In review; Branch=feat/A01-eval-dataset; PR=<url>
```

## A02

**Eval runner: npm run eval writes the eval report (+ --record fixtures for mock mode)** · Owner: Adarsh · Lane: **QA lane** · Slot: Wed 14:00–18:00 · Est: 1.0 h · Depends on: A01, T11, T12, T10 · Branch: `feat/A02-eval-runner`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task A02: Eval runner: npm run eval writes the eval report (+ --record fixtures for mock mode).
Branch: feat/A02-eval-runner. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Create scripts/eval.ts: for each eval/pairs/*/case.json → criteria (generateCriteria or case.criteria if present) → ingest images to a temp UPLOAD_DIR → verifyEvidence → runForensics (other cases count as "other jobs", so reuse cases trigger) → decide → compare to expected. Output eval/report.md: table per case (expected vs got, score, flags, latency ms), confusion matrix, outcome accuracy, FALSE CAPTURES (expected not in {APPROVED, PARTIAL} but got APPROVED; target 0), false holds, total tokens/cost if available. `--record` writes eval/fixtures/<sha256-first-after>.json for mock mode. `--case 05` to run one case. Uses only exported functions from src/server/vision/* (read-only; don't edit them; report bugs as Notion tasks).

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
scripts/eval.ts runs criteria(from case.json or generator)->forensics->VLM->decide per case; writes eval/report.md with confusion matrix, false-capture count, latency; --record writes eval/fixtures/<sha256>.json; report committed.

RULES
- Make a 5-10 line plan first, then implement in small commits "A02: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[A02] Eval runner: npm run eval writes the eval report (+ --record fixtures for mock mode)" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: A02 → In review; Branch=feat/A02-eval-runner; PR=<url>
```

## A03

**E2E happy path: create job -> sandbox PayPal authorize -> upload -> APPROVED -> CAPTURED** · Owner: Collaborator · Lane: **QA lane** · Slot: Wed 19:30–23:30 · Est: 1.5 h · Depends on: F03, F04, F06, T13 · Branch: `feat/A03-e2e-happy`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task A03: E2E happy path: create job -> sandbox PayPal authorize -> upload -> APPROVED -> CAPTURED.
Branch: feat/A03-e2e-happy. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Set up Playwright (playwright.config.ts with webServer: `npm run dev`, env VISION_MOCK=1, baseURL http://localhost:3000) and write tests/e2e/happy.spec.ts + tests/e2e/helpers/{paypal.ts,api.ts}:
1. /?as=customer → New job (bike chain, $60) → save → PayPal button → popup → sandbox login (E2E_BUYER_EMAIL/PASSWORD) → approve → expect [data-testid=funds-held].
2. /?as=worker → job → upload eval/pairs/06-*/before_1.jpg and after_1.jpg → submit.
3. /?as=customer → expect status CAPTURED in the timeline within 30s.
Use the browser to explore selectors and record a walkthrough first, then codify it in Playwright. Save the recording locally (`docs/recordings/` is git-ignored). Missing data-testids → list them in the hand-off for the Frontend lane.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
tests/e2e/happy.spec.ts (Playwright) passes locally with VISION_MOCK=1 and sandbox buyer creds from env (E2E_BUYER_EMAIL/PASSWORD); A browser recording saved to docs/recordings/ (not committed if >10MB).

RULES
- Make a 5-10 line plan first, then implement in small commits "A03: <summary>".
- Run `npm run check` until green and `npm run e2e`.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[A03] E2E happy path: create job -> sandbox PayPal authorize -> upload -> APPROVED -> CAPTURED" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: A03 → In review; Branch=feat/A03-e2e-happy; PR=<url>
```

## A04

**E2E partial + fraud paths (PARTIAL accept -> partial capture; duplicate -> HUMAN_REVIEW -> void)** · Owner: Collaborator · Lane: **QA lane** · Slot: Thu 09:00–12:00 · Est: 1.0 h · Depends on: A03, F07, T14 · Branch: `feat/A04-e2e-partial-fraud`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task A04: E2E partial + fraud paths (PARTIAL accept -> partial capture; duplicate -> HUMAN_REVIEW -> void).
Branch: feat/A04-e2e-partial-fraud. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Add tests/e2e/partial.spec.ts (cleaning case 04 → PARTIAL → accept-proposal → CAPTURED with captured < authorized) and tests/e2e/fraud.spec.ts (delivery with the eval/stock image → HUMAN_REVIEW → /?as=reviewer → Reject → VOIDED). Run the whole suite 3× to check for flakiness. Every bug → a new Notion row (Task ID B01…, Owner/Tool = owner of the failing path, Status Todo) with repro steps.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
tests/e2e/partial.spec.ts and fraud.spec.ts pass; bugs found filed as Notion tasks (Status Todo, Owner by folder).

RULES
- Make a 5-10 line plan first, then implement in small commits "A04: <summary>".
- Run `npm run check` until green and `npm run e2e`.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[A04] E2E partial + fraud paths (PARTIAL accept -> partial capture; duplicate -> HUMAN_REVIEW -> void)" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: A04 → In review; Branch=feat/A04-e2e-partial-fraud; PR=<url>
```

## A05

**Demo dry-run on hosted Render URL; capture screenshots + backup screen recording** · Owner: Collaborator · Lane: **QA lane** · Slot: Thu 12:30–15:00 · Est: 1.0 h · Depends on: T15, A04, F08 · Branch: `feat/A05-demo-dryrun`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task A05: Demo dry-run on hosted Render URL; capture screenshots + backup screen recording.
Branch: feat/A05-demo-dryrun. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
On the HOSTED Render URL: use the browser subagent to run the three demo jobs from docs/DEMO_AND_SUBMISSION.md §1 in order, exactly as the video script, capturing screenshots of each shot and a recording if produced. Produce an artifact "Demo dry-run report": per shot OK/glitch + timing. Glitches → Notion rows. Also time the cold start of the Render instance.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
All 3 demo jobs run on Render with sandbox; backup recording of each flow saved locally; list of glitches posted in Notion.

RULES
- Make a 5-10 line plan first, then implement in small commits "A05: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[A05] Demo dry-run on hosted Render URL; capture screenshots + backup screen recording" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: A05 → In review; Branch=feat/A05-demo-dryrun; PR=<url>
```

## A06

**Fresh-clone judge test: follow README from zero in a clean folder** · Owner: Collaborator · Lane: **QA lane** · Slot: Thu 12:30–15:00 · Est: 0.75 h · Depends on: T15 · Branch: `feat/A06-readme-fixes`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task A06: Fresh-clone judge test: follow README from zero in a clean folder.
Branch: feat/A06-readme-fixes. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
In a fresh temp folder: `git clone https://github.com/adarsh-nl/proofpay.git && cd proofpay` and follow ONLY README.md, literally, with VISION_MOCK=1 and sandbox creds supplied by the human via env. Note every place you had to guess. Fix README wording in a docs-only PR (branch feat/A06-readme-fixes). Success = happy path completes from a clean clone.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
New clone, only README instructions, VISION_MOCK=1: app runs and happy path completes; every README fix committed.

RULES
- Make a 5-10 line plan first, then implement in small commits "A06: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[A06] Fresh-clone judge test: follow README from zero in a clean folder" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: A06 → In review; Branch=feat/A06-readme-fixes; PR=<url>
```

## A07

**Fill the README Try it (sandbox) buyer login once the sandbox personal account exists** · Owner: Adarsh · Lane: **QA lane** · Slot: Tue 14:00–16:00 · Est: 0.25 h · Depends on: — · Branch: `docs/A07-sandbox-login`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task A07: Fill the README Try it (sandbox) buyer login once the sandbox personal account exists.
Branch: docs/A07-sandbox-login. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md and the README section "Try it (sandbox)".

WHAT TO DO
Docs-only. When the PayPal sandbox personal (buyer) account exists, replace the README placeholders `<sandbox-buyer-email>` and `<sandbox-buyer-password>` with that account's email and password. Keep the "Sandbox only. No real money moves." warning. Do not invent credentials. Do not put the password in `.env.example`, Notion, the PR body, or chat. `.env.example` stays empty placeholders.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
README 'Try it (sandbox)' shows the real sandbox personal (buyer) email and password, marked sandbox-only and no real money. Values come from the PayPal Developer Dashboard sandbox account. .env.example stays placeholders. The login is not pasted into Notion, PR text, or chat.

RULES
- Make a 5-10 line plan first, then implement in small commits "A07: <summary>".
- Never print or commit secrets/.env.local. The README sandbox buyer login is the one exception the owner approved, and only there.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[A07] Fill the README Try it (sandbox) buyer login once the sandbox personal account exists" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: A07 → In review; Branch=docs/A07-sandbox-login; PR=<url>
```

## S01

**Record + edit demo video (<3:00), upload to YouTube public** · Owner: Adarsh · Lane: **QA lane** · Slot: Thu 12:30–15:00 · Est: 1.5 h · Depends on: A05 · Branch: `n/a`

In the repo root, paste:

```text
You are working on ProofPay (read AGENTS.md first). Task S01: Record + edit demo video (<3:00), upload to YouTube public.
Branch: n/a. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
(Human-led.) Use docs/DEMO_AND_SUBMISSION.md §1. Optional help from the QA lane: generate a shot checklist and time each segment from the A05 recordings. Record with OBS/QuickTime, edit to 2:40–2:55, add captions, no copyrighted music. Upload to YouTube as Public, title "ProofPay: vision-verified escrow on PayPal (PayPal AI Hackathon)". Paste the link in Notion S01 notes.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
Video follows docs/DEMO_AND_SUBMISSION.md script, 2:40–2:55 long, captions on, no copyrighted music, public YouTube link in Notion.

RULES
- Make a 5-10 line plan first, then implement in small commits "S01: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[S01] Record + edit demo video (<3:00), upload to YouTube public" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: S01 → In review; Branch=n/a; PR=<url>
```

## S02

**Devpost submission: text, Built With, tools used, repo URL, video, hosted URL, testing instructions** · Owner: Collaborator · Lane: **Backend lane** · Slot: Thu 15:00–18:00 · Est: 1.0 h · Depends on: S01, A06 · Branch: `docs/S02-devpost`

In the repo root (or a worktree), paste:

```text
You are working on ProofPay (read AGENTS.md first). Task S02: Devpost submission: text, Built With, tools used, repo URL, video, hosted URL, testing instructions.
Branch: docs/S02-devpost. Only modify paths your lane owns (AGENTS.md §4).
Read: AGENTS.md, src/shared/contracts.ts (if present), and the docs/MANUAL.md sections named below.

WHAT TO DO
Draft the Devpost text from docs/DEMO_AND_SUBMISSION.md §3 using the real numbers from eval/report.md and the real hosted URL; save it as docs/DEVPOST.md (docs-only PR). Point judges at the README quickstart and "Try it (sandbox)" (A07 fills the buyer login). Enter both sponsor targets: Render and AG Grid. The AI-tools list goes in the Devpost form, not in the repo. Then the humans paste it into Devpost and tick the checklist in §2. Adarsh submits.

ACCEPTANCE CRITERIA (all must be true; quote each in the PR with how you verified it)
Checklist in docs/DEMO_AND_SUBMISSION.md all ticked, including both Render and AG Grid sponsor fields; draft saved by Collaborator by 16:00 CET; Adarsh (team Representative) reviews and submits before 18:00 CET; repo public with MIT licence visible in About; screenshot of submission confirmation saved.

RULES
- Make a 5-10 line plan first, then implement in small commits "S02: <summary>".
- Run `npm run check` until green.
- Never print or commit secrets/.env.local. Sandbox only.
- If you need a change outside your owned paths, STOP and describe it (file, function, signature) in the hand-off.
- Finish: open PR "[S02] Devpost submission: text, Built With, tools used, repo URL, video, hosted URL, testing instructions" using .github/pull_request_template.md, then output the AGENTS.md §10 hand-off block ending with
  NOTION: S02 → In review; Branch=docs/S02-devpost; PR=<url>
```

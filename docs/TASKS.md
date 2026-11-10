# ProofPay — Tasks

> **The live task board is in Notion. It's the source of truth for status.**
> - Project page: https://app.notion.com/p/4145007c7d318100acf3ee62d7b1b521
> - Tasks database: https://app.notion.com/p/e1809761315044039838e9ff7bc70f02
>
> Each Notion row's **Prompt link / notes** points to `https://github.com/adarsh-nl/proofpay/blob/main/docs/AGENT_PROMPTS.md#<taskid>`.
>
> This file is a **static snapshot** (generated Tue 10 Nov 2026 13:45 CET from `docs/tasks.json`). Don't update statuses here; update them in Notion (see `AGENTS.md` §9). If you add or rename a task, update Notion **and** `docs/tasks.json` in the same PR.

## Lane split and why

| Lane | Strength we use it for | Owns these paths (write access) |
|---|---|---|
| **Backend lane** | Backend logic, PayPal REST integration, state machine, tests run in the loop (`npm test` after every change), scripts, Render blueprint. | `src/server/**`, `src/shared/**` (contract owner), `src/app/api/**`, `tests/unit/**`, `scripts/**` (except `scripts/eval*.ts`), `drizzle/**`, `render.yaml`, `.github/**` |
| **Frontend lane** | React UI: Tailwind/shadcn layouts and copy, plus the AG Grid escrow/ledger dashboard. | `src/app/**` **except** `src/app/api/**`, `src/components/**`, `src/lib/**` (client helpers), `src/styles/**`, `public/**` |
| **QA lane** | Eval photos and the eval runner, Playwright browser end-to-end tests, demo dry-runs, and the fresh-clone judge test. | `tests/e2e/**`, `eval/**`, `scripts/eval*.ts`, `playwright.config.ts`, `docs/img/**`, `docs/recordings/**` (git‑ignored if large) |

Everyone may edit `docs/**` and `README.md` in **docs‑only PRs** (`docs/<id>-…` branches). Shared files (`package.json`, `package-lock.json`, `.env.example`, `src/shared/contracts.ts`) need extra care, see `docs/COLLABORATION.md` §4.

**Humans:**
- **Adarsh** (CV PhD): drives **Backend lane** (backend + vision) and **QA lane** (eval dataset + runner). Final say on vision thresholds and the demo story. He's the Devpost team Representative.
- **Collaborator**: drives **Frontend lane** (all UI) and **QA lane** (e2e, demo dry‑runs, README judge test), plus Backend lane for T12, T15 and S02.

Each human can run two agents in parallel as long as they write to different folders. Estimates are wall‑clock time for agent + review.

## Timeline (CET, Europe/Amsterdam)

| Slot | Adarsh | Collaborator | Gate at end of slot |
|---|---|---|---|
| **Tue 14:00–16:00** | Sandbox app + creds (MANUAL §10.1), A07 once the personal account exists, T00, T01 | Read docs, install Node and Chrome, F01 (starts once T00 is merged, ~14:45) | T00 + T01 merged, contracts frozen (16:00) |
| **Tue 16:00–19:00** | T02, T03, T09 | F02 | `npm run db:reset` works, sandbox token OK |
| **Tue 20:30–23:00** | T04, T08, T11 (Backend lane) · A01 photo shoot (QA lane) | (optional) F04 start | First real VLM verdict on 1 pair |
| **Wed 08:00–09:00** | A01 finish photos | — | ≥ 12 eval pairs committed |
| **Wed 09:00–13:00** | T05, T06, T10, T07 | F03, F04, T12 (Backend lane) | **13:00 sync**: authorize → upload works end‑to‑end locally |
| **Wed 14:00–18:00** | T13, T14, A02 | F05, F06 | **18:00 MVP FREEZE**: all MVP tasks merged; happy + partial paths work locally |
| **Wed 19:30–23:30** | Stretch: T16/T17/T18 (pick at most 2) | T15 Render deploy, F07, F09 AG Grid ledger (both sponsors required), A03 | Hosted URL live; ledger visible; happy e2e green |
| **Thu 08:00–12:00** | **US visa interview 09:15, offline** | A04, F08 | Partial + fraud e2e green |
| **Thu 12:30–15:00** | S01 record video | A05, A06 | **15:00 CODE FREEZE** (only README/docs after) |
| **Thu 15:00–18:00** | Review + submit Devpost (S02) | S02 draft by 16:00 | **Submitted by 18:00 CET** (hard deadline 21:00 CET = 12:00 PST) |

Critical path: `T00 → T01 → T02/T03 → T04 → T05 → T06 → T13 → T14 → T15 → A05 → S01 → S02`.

## Task snapshot


### Backend / PayPal / vision (Backend lane)

| ID | Title | Owner | Lane | Slot | Est (h) | Depends on | Branch | Tier |
|---|---|---|---|---|---|---|---|---|
| T00 | Repo bootstrap: Next.js+TS scaffold, tooling, scripts, CI | Adarsh | Backend lane | Tue 14:00–16:00 | 0.75 | — | `feat/T00-bootstrap` | MVP |
| T01 | Shared contracts: zod schemas + escrow transition table (src/shared/*) | Adarsh | Backend lane | Tue 14:00–16:00 | 0.75 | T00 | `feat/T01-contracts` | MVP |
| T02 | DB schema (Drizzle + better-sqlite3), repositories, seed script | Adarsh | Backend lane | Tue 16:00–19:00 | 1.0 | T01 | `feat/T02-db` | MVP |
| T03 | PayPal REST client: OAuth token cache, ppFetch, PayPal-Request-Id, error mapping | Adarsh | Backend lane | Tue 16:00–19:00 | 1.0 | T00 | `feat/T03-paypal-client` | MVP |
| T04 | Orders v2: create (intent AUTHORIZE) + authorize + get; API endpoints 5–6 | Adarsh | Backend lane | Tue 20:30–23:00 | 1.0 | T02, T03 | `feat/T04-orders-authorize` | MVP |
| T05 | Payments v2: capture full/partial (final_capture), void, refund, reauthorize, get auth | Adarsh | Backend lane | Wed 09:00–13:00 | 1.0 | T03 | `feat/T05-payments-ops` | MVP |
| T06 | Escrow state machine + settle.ts (PayPal side effects before transitions) | Adarsh | Backend lane | Wed 09:00–13:00 | 1.5 | T02, T05 | `feat/T06-escrow` | MVP |
| T07 | Job + evidence API routes (endpoints 1–4, 7–9, 11–15, 17, 20, 21) with withErrors() | Adarsh | Backend lane | Wed 09:00–13:00 | 1.5 | T06, T09 | `feat/T07-api-routes` | MVP |
| T08 | Criteria generator (LLM generateObject) + category fallback templates + liveness criterion | Adarsh | Backend lane | Tue 20:30–23:00 | 1.0 | T01 | `feat/T08-criteria` | MVP |
| T09 | Evidence ingest: sharp resize, sha256, dHash, exifr EXIF; store under UPLOAD_DIR | Adarsh | Backend lane | Tue 16:00–19:00 | 1.0 | T02 | `feat/T09-evidence-ingest` | MVP |
| T10 | Forensics checks (duplicates, before≈after, EXIF window, scene/screenshot flags) | Adarsh | Backend lane | Wed 09:00–13:00 | 1.0 | T09 | `feat/T10-forensics` | MVP |
| T11 | VLM verifier (generateObject, image labelling, retry-on-invalid, mock fixtures) | Adarsh | Backend lane | Tue 20:30–23:00 | 1.5 | T01, T09 | `feat/T11-vlm-verify` | MVP |
| T12 | Decision engine (pure) + thresholds from env | Collaborator | Backend lane | Wed 09:00–13:00 | 0.75 | T01 | `feat/T12-decide` | MVP |
| T13 | Verification orchestrator: submit -> VERIFYING -> forensics+VLM -> decide -> settle/agent | Adarsh | Backend lane | Wed 14:00–18:00 | 1.0 | T06, T10, T11, T12 | `feat/T13-orchestrator` | MVP |
| T14 | Settlement agent v1 (AI SDK tools, policy gate, proposals, evidence pack markdown, PayPal Agent Toolkit read tools) | Adarsh | Backend lane | Wed 14:00–18:00 | 2.0 | T13 | `feat/T14-agent` | MVP |
| T15 | Render deploy: render.yaml, health check, SEED_ON_BOOT, env vars; hosted URL in README | Collaborator | Backend lane | Wed 19:30–23:30 | 0.75 | T13 | `feat/T15-render` | MVP |
| T16 | STRETCH: PayPal webhooks route with signature verification | Adarsh | Backend lane | Wed 19:30–23:30 | 1.0 | T15 | `feat/T16-webhooks` | Stretch |
| T17 | STRETCH: Reauthorize button + honor-period countdown | Adarsh | Backend lane | Wed 19:30–23:30 | 0.75 | T05, F06 | `feat/T17-reauthorize` | Stretch |
| T18 | STRETCH: Payouts to worker after capture (simulated) | Adarsh | Backend lane | Wed 19:30–23:30 | 1.0 | T13 | `feat/T18-payouts` | Stretch |

### Frontend (Frontend lane)

| ID | Title | Owner | Lane | Slot | Est (h) | Depends on | Branch | Tier |
|---|---|---|---|---|---|---|---|---|
| F01 | App shell: layout, role switcher (?as=), nav, theme, shadcn setup, landing page with origin story | Collaborator | Frontend lane | Tue 14:00–16:00 | 1.0 | T00 | `feat/F01-app-shell` | MVP |
| F02 | Customer: create job form + editable criteria preview | Collaborator | Frontend lane | Tue 16:00–19:00 | 1.5 | F01, T01 | `feat/F02-create-job` | MVP |
| F03 | PayPal Buttons checkout (intent=authorize) on job page | Collaborator | Frontend lane | Wed 09:00–13:00 | 1.0 | F02, T04 | `feat/F03-paypal-buttons` | MVP |
| F04 | Worker: evidence upload (before/after, camera capture, previews, liveness code banner) | Collaborator | Frontend lane | Wed 09:00–13:00 | 1.5 | F01, T01 | `feat/F04-worker-upload` | MVP |
| F05 | Verification result view: per-criterion cards + bounding-box overlay + forensics flags | Collaborator | Frontend lane | Wed 14:00–18:00 | 2.0 | F04, T01 | `feat/F05-result-view` | MVP |
| F06 | Money timeline + settlement panel (accept/decline partial, void, PayPal IDs) | Collaborator | Frontend lane | Wed 14:00–18:00 | 1.5 | F05, T06 | `feat/F06-timeline-settlement` | MVP |
| F07 | Reviewer console: queue table, job detail, approve/partial/reject, evidence pack | Collaborator | Frontend lane | Wed 19:30–23:30 | 1.5 | F05, T07 | `feat/F07-reviewer` | MVP |
| F08 | Demo polish: empty/loading/error states, copy, favicon, OG image, screenshots for README | Collaborator | Frontend lane | Thu 09:00–12:00 | 1.0 | F06, F07 | `feat/F08-polish` | MVP |
| F09 | AG Grid escrow/ledger dashboard (jobs, held/captured/released, flags) | Collaborator | Frontend lane | Wed 19:30–23:30 | 1.5 | F07 | `feat/F09-ag-grid` | MVP |

### E2E, eval, demo (QA lane)

| ID | Title | Owner | Lane | Slot | Est (h) | Depends on | Branch | Tier |
|---|---|---|---|---|---|---|---|---|
| A01 | Eval dataset: shoot 12–20 before/after pairs + case.json labels (human-heavy) | Adarsh | QA lane | Tue 20:30–23:00 + Wed 08:00–09:00 | 2.0 | — | `feat/A01-eval-dataset` | MVP |
| A02 | Eval runner: npm run eval writes the eval report (+ --record fixtures for mock mode) | Adarsh | QA lane | Wed 14:00–18:00 | 1.0 | A01, T11, T12, T10 | `feat/A02-eval-runner` | MVP |
| A03 | E2E happy path: create job -> sandbox PayPal authorize -> upload -> APPROVED -> CAPTURED | Collaborator | QA lane | Wed 19:30–23:30 | 1.5 | F03, F04, F06, T13 | `feat/A03-e2e-happy` | MVP |
| A04 | E2E partial + fraud paths (PARTIAL accept -> partial capture; duplicate -> HUMAN_REVIEW -> void) | Collaborator | QA lane | Thu 09:00–12:00 | 1.0 | A03, F07, T14 | `feat/A04-e2e-partial-fraud` | MVP |
| A05 | Demo dry-run on hosted Render URL; capture screenshots + backup screen recording | Collaborator | QA lane | Thu 12:30–15:00 | 1.0 | T15, A04, F08 | `feat/A05-demo-dryrun` | MVP |
| A06 | Fresh-clone judge test: follow README from zero in a clean folder | Collaborator | QA lane | Thu 12:30–15:00 | 0.75 | T15 | `feat/A06-readme-fixes` | MVP |
| A07 | Fill the README Try it (sandbox) buyer login once the sandbox personal account exists | Adarsh | QA lane | Tue 14:00–16:00 | 0.25 | — | `docs/A07-sandbox-login` | MVP |

### Submission

| ID | Title | Owner | Lane | Slot | Est (h) | Depends on | Branch | Tier |
|---|---|---|---|---|---|---|---|---|
| S01 | Record + edit demo video (<3:00), upload to YouTube public | Adarsh | QA lane | Thu 12:30–15:00 | 1.5 | A05 | `n/a` | MVP |
| S02 | Devpost submission: text, Built With, tools used, repo URL, video, hosted URL, testing instructions | Collaborator | Backend lane | Thu 15:00–18:00 | 1.0 | S01, A06 | `docs/S02-devpost` | MVP |

## Acceptance criteria (snapshot)

- **T00**: npm ci && npm run lint && npm run typecheck && npm test && npm run build pass; scripts dev/build/start/lint/typecheck/test/db:reset/eval exist; .github/workflows/ci.yml runs them; LICENSE, .gitignore, .env.example committed; folder skeleton from docs/DIRECTORY_TREE.md exists with .gitkeep files.
- **T01**: src/shared/contracts.ts exports every type in MANUAL §8 and §9.2 (Money, Criterion, Job, PaymentSummary, EventItem, VerificationReportSchema, ForensicsReport, Decision, SettlementProposal, ApiError); src/shared/escrow.ts exports ESCROW_STATUSES, TRANSITIONS, canTransition(); unit tests cover every allowed and 3 illegal transitions. FROZEN after merge (contract-change label required).
- **T02**: src/server/db/schema.ts matches MANUAL §6; npm run db:reset creates ./data/proofpay.db and seeds 3 demo jobs (bike, cleaning, delivery) in CREATED; repo functions getJob/listJobs/insertEvent/updateStatus typed; unit test with in-memory db.
- **T03**: src/server/paypal/client.ts: getAccessToken caches until expiry-60s; ppFetch sets Bearer, Prefer: return=representation, PayPal-Request-Id; PayPalError(status, issue, debugId); unit tests with mocked fetch; scripts/paypal-smoke.ts gets a sandbox token (run manually).
- **T04**: POST /api/paypal/orders returns orderId from sandbox; POST /api/paypal/orders/:id/authorize stores authorization id, status, expiration_time, honor_period_ends_at, generates 4-digit liveness code, moves job to AUTHORIZED; manual sandbox test logged in PR with order id and authorization id.
- **T05**: src/server/paypal/payments.ts exports captureAuthorization(authId,{amount?,finalCapture:true,invoiceId}), voidAuthorization, refundCapture, reauthorize, getAuthorization; idempotency rows in paypal_idempotency; sandbox test notes in PR: partial capture of 80% then GET authorization shows remaining released (record actual behaviour in docs/REFERENCES.md).
- **T06**: transition() atomic with events row; IllegalTransition -> 409; settle(job, decision) does capture/partial/void; AUTO_CAPTURE_ON_APPROVE honoured; PARTIAL capture requires customer accept event; tests cover each path with mocked PayPal.
- **T07**: All routes in MANUAL §8 respond with documented shapes (zod-validated); upload limits enforced; role cookie checked; route tests via vitest + next test helpers or supertest-like handler calls; curl examples in docs/API_EXAMPLES.md.
- **T08**: generateCriteria(job) returns 3–6 criteria, weights sum 1±0.001, plus system cL liveness criterion; timeout 20s -> template; VISION_MOCK=1 returns template without network; tests for normalisation + fallback.
- **T09**: ingestImage(buffer) -> {sha256,dhash(16 hex),width,height,exifTakenAt?,storedPath}; rejects non-image by sharp metadata; dHash identical for re-encoded copy (hamming<=6) and different for unrelated images (>=20) in tests using eval sample images.
- **T10**: runForensics(job, evidence, vlmReport?) -> ForensicsReport per MANUAL §9.3 table; compares against other jobs and eval/stock; unit tests for each flag.
- **T11**: verifyEvidence() returns VerificationReport (zod) with boxes; prompt exactly as MANUAL §9.2 in src/server/vision/prompts.ts; one retry on zod failure; VISION_MOCK reads eval/fixtures; manual run on 3 eval pairs pasted in PR.
- **T12**: decide(criteria, report, forensics, amount) implements MANUAL §9.4 exactly; >=12 table-driven unit tests incl. liveness missing, HIGH flag, partial rounding (floor to 0.05).
- **T13**: POST /api/jobs/:id/submit returns 202 and verification completes in-process; verifications row stored; outcome transitions correct; APPROVED auto-captures in sandbox; errors -> HUMAN_REVIEW with reason.
- **T14**: runSettlementAgent(jobId) writes SettlementProposal event for PARTIAL with explanation citing criterion ids; money tools refuse without approval event (unit-tested); evidence-pack endpoint returns markdown; Agent Toolkit get_order used to show order state in pack; mock mode deterministic.
- **T15**: render.yaml blueprint (web service, node, build npm ci && npm run build, start npm start, healthCheckPath /api/health); deployed URL loads and runs happy path in sandbox; README updated with URL. This is the Render sponsor submission, alongside the AG Grid ledger (F09).
- **T16**: POST /api/webhooks/paypal verifies via /v1/notifications/verify-webhook-signature; rejects on failure (400); logs WEBHOOK event; tested with sandbox webhook to Render URL.
- **T17**: Endpoint 16 works or shows the PayPal error gracefully; UI countdown to honor_period_ends_at.
- **T18**: After CAPTURED, optional POST /v1/payments/payouts to worker sandbox email; payout batch id in timeline; behind PAYOUTS_ENABLED=1.
- **F01**: / shows pitch + 3 role cards; ?as=customer|worker|reviewer sets pp_role cookie; header shows current role + 'Sandbox' badge; mobile responsive; Lighthouse a11y >= 90 on landing.
- **F02**: /customer/new form (title, description, category, amount) posts to /api/jobs (use src/lib/api-client.ts typed with contracts; mock with MSW or fixture until T07 lands); criteria list editable (label, required, weight) with live weight total; liveness criterion locked.
- **F03**: @paypal/react-paypal-js (or SDK script) with intent=authorize&currency=USD; createOrder calls endpoint 5; onApprove calls endpoint 6; success shows 'Funds held' with authorization id and expiry; works with sandbox buyer login.
- **F04**: /worker/jobs/[id]: two dropzones (before/after), capture=environment on mobile, thumbnails, remove; big banner 'Write code 4821 on paper and include it in an after photo'; Submit disabled until >=1 after image; calls endpoints 7–9.
- **F05**: Component <EvidenceViewer> draws box_2d [ymin,xmin,ymax,xmax]/1000 on images (scales with resize); <CriterionCard> shows verdict chip, confidence bar, rationale; hover card highlights boxes; flags panel (HIGH red, MEDIUM amber); built against eval fixture JSON first.
- **F06**: <MoneyTimeline> renders events (Held $120 -> Verified 4/5 -> Captured $96 -> Released $24) with PayPal order/auth/capture ids and sandbox links; agent proposal card with Accept/Decline calling endpoints 11–12; polling every 2s while VERIFYING.
- **F07**: /reviewer lists HUMAN_REVIEW jobs (endpoint 17); detail reuses F05; decision form posts endpoint 13; 'Generate evidence pack' shows markdown (endpoint 18) with copy/download; passcode prompt if REVIEWER_PASSCODE set.
- **F08**: No raw JSON visible to users; toasts for errors; consistent copy; README screenshots in docs/img/; all pages work at 390px width.
- **F09**: AG Grid Community grid is the escrow/ledger dashboard: every job with status, held, captured, and released amounts, and fraud flags; column filter and sort; `ag-grid-react` and `ag-grid-community` installed; named in README Built with and in the Devpost sponsor fields together with the Render deploy (T15).
- **A01**: eval/pairs/NN-slug/{case.json,before_*.jpg,after_*.jpg} for >=12 cases from MANUAL §9.5 table; images <=1600px, no faces/PII; eval/stock has 2 images; case.json skeletons and scripts/eval-validate.ts exist and npm run eval:validate passes.
- **A02**: scripts/eval.ts runs criteria(from case.json or generator)->forensics->VLM->decide per case; writes eval/report.md with confusion matrix, false-capture count, latency; --record writes eval/fixtures/<sha256>.json; report committed.
- **A03**: tests/e2e/happy.spec.ts (Playwright) passes locally with VISION_MOCK=1 and sandbox buyer creds from env (E2E_BUYER_EMAIL/PASSWORD); a browser recording saved to docs/recordings/ (not committed if >10MB).
- **A04**: tests/e2e/partial.spec.ts and fraud.spec.ts pass; bugs found filed as Notion tasks (Status Todo, Owner by folder).
- **A05**: All 3 demo jobs run on Render with sandbox; backup recording of each flow saved locally; list of glitches posted in Notion.
- **A06**: New clone, only README instructions, VISION_MOCK=1: app runs and happy path completes; every README fix committed.
- **S01**: Video follows docs/DEMO_AND_SUBMISSION.md script, 2:40–2:55 long, captions on, no copyrighted music, public YouTube link in Notion.
- **A07**: README "Try it (sandbox)" shows the real sandbox personal (buyer) email and password, marked sandbox-only and no real money. Values come from the PayPal Developer Dashboard sandbox account. `.env.example` stays placeholders. The login is not pasted into Notion, PR text, or chat.
- **S02**: Checklist in docs/DEMO_AND_SUBMISSION.md all ticked, including both Render and AG Grid sponsor fields; draft saved by Collaborator by 16:00 CET; Adarsh (team Representative) reviews and submits before 18:00 CET; repo public with MIT licence visible in About; screenshot of submission confirmation saved.

## Totals

- Adarsh: 20.75 h MVP + 2.75 h stretch (across 2 parallel lanes)
- Collaborator: 19.25 h MVP + 0 h stretch (across 2 parallel lanes)

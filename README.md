# ProofPay — vision‑verified escrow payments on PayPal

> **Money moves when the camera says the job is done.**
> Built for the [PayPal AI Hackathon](https://paypalaihackathon.devpost.com/) (submissions close **Thu 12 Nov 2026, 12:00 PST = 21:00 CET**).

ProofPay holds a customer's payment with a **PayPal authorization** (Orders v2, `intent: AUTHORIZE`), asks the worker for **before/after photo evidence**, and lets a **vision‑language model** check that evidence against a checklist an LLM generated from the job description. Pass → PayPal **capture**. Partially done → an **AI settlement agent** proposes a **partial capture** with a plain‑English explanation. Fail, suspected fraud or low confidence → funds stay on hold and a **human reviewer** gets an evidence report (which can be reused as dispute evidence).

---

## The problem (one paragraph)

Paying for real‑world work is still trust‑by‑default. Marketplaces either pay the worker the moment the customer clicks "pay" (customer carries the risk) or after a vague "mark as done" button (worker's word against the customer's). Parcels get marked "delivered" with no photo; cleaners, handymen and couriers get paid — or don't — based on whoever complains loudest, and the dispute is settled weeks later from screenshots. Card holds and escrow exist, but **nobody checks the actual evidence before the money moves**. ProofPay makes the evidence the trigger: an authorization hold for up to 29 days, a computer‑vision check of before/after proof against explicit acceptance criteria, fraud checks on the photos themselves, and a capture, partial capture or void that follows from that check — with an audit trail both sides can see.

## Demo story (origin)

On 7 Nov 2026 a parcel tracker said Adarsh's new Fitbit was *"delivered"* in Enschede. The tracker never arrived. There was no delivery photo, just a status line, and the missing Fitbit turned into days of support calls. **With ProofPay the courier's payout would have stayed on hold until a photo of the Fitbit parcel at the right door, with that day's one‑time code visible, passed verification.**

The 3‑minute demo (see [`docs/DEMO_AND_SUBMISSION.md`](docs/DEMO_AND_SUBMISSION.md)) shows three jobs:
1. **Bike chain replacement**: verified, **full capture** in the PayPal sandbox.
2. **Apartment cleaning, 4 of 5 criteria met**: the agent proposes a **partial capture** (e.g. 80%) and the customer accepts in one click.
3. **"Delivered" Fitbit with a reused photo**: the duplicate‑image check fires, funds stay **on hold**, the job goes to **human review**, an evidence pack is generated, and the authorization is **voided**.

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    C[Customer UI<br/>Next.js + PayPal JS SDK<br/>intent=authorize]
    W[Worker UI<br/>photo upload / camera]
    R[Reviewer console<br/>AG Grid escrow ledger]
  end

  subgraph "ProofPay app (Next.js, TypeScript, one Render web service)"
    API[API routes /api/*]
    ESC[Escrow state machine]
    CRIT[Criteria generator<br/>LLM → JSON checklist]
    VIS[Vision verifier<br/>VLM → per-criterion verdicts + boxes]
    FOR[Forensics<br/>EXIF · dHash duplicates · before/after diff · liveness code]
    DEC[Decision engine<br/>thresholds → APPROVE / PARTIAL / REJECT / HUMAN_REVIEW]
    AG[Settlement agent<br/>AI SDK tool-calling + PayPal Agent Toolkit]
    DB[(SQLite<br/>Drizzle ORM)]
    FS[(uploads/)]
  end

  PP[(PayPal Sandbox<br/>Orders v2 · Payments v2<br/>Webhooks · Disputes)]
  LLM[(Hosted VLM/LLM<br/>the configured vision provider)]

  C -->|create job| API
  C -->|approve PayPal popup| PP
  API -->|create order / authorize| PP
  W -->|before/after photos| API --> FS
  API --> ESC
  ESC --> CRIT --> LLM
  ESC --> FOR
  ESC --> VIS --> LLM
  FOR --> DEC
  VIS --> DEC --> ESC
  ESC --> AG
  AG -->|capture / partial capture / void / refund| PP
  R -->|override| API
  PP -->|"webhooks (stretch)"| API
  API <--> DB
```

## Quickstart (judges)

Requirements: Node.js 22+ (`node -v`), npm 10+, git. For the real PayPal flow you also need a free [PayPal Developer](https://developer.paypal.com/) account (sandbox). Optional: an API key for the configured vision provider.

**Fastest path, no accounts or keys (mock mode):**

```bash
git clone https://github.com/adarsh-nl/proofpay.git && cd proofpay
npm ci
cp .env.example .env.local
#  Edit .env.local and set these three to 1 (VISION_MOCK is already 1):
#    PAYPAL_MOCK=1                 (PayPal calls are served by an in-memory fake; no network)
#    NEXT_PUBLIC_PAYPAL_MOCK=1     (the job page shows "Simulate PayPal approval (mock)" instead of the PayPal popup)
#    VISION_MOCK=1                 (deterministic AI verification; no AI key)
npm run db:reset                  # creates ./data/proofpay.db, seeds 3 demo jobs
npm run dev                       # → http://localhost:3000
```

`bash eval/judge-test.sh` does exactly this on a fresh clone (install, build, start, then the bike job from "create" to "captured") and prints `JUDGE TEST PASSED`.

**With the real PayPal sandbox:**

```bash
git clone https://github.com/adarsh-nl/proofpay.git && cd proofpay
npm ci
cp .env.example .env.local
#  Edit .env.local:
#    PAYPAL_CLIENT_ID=<sandbox client id>       (Developer Dashboard → Apps & Credentials → Sandbox → Create App)
#    PAYPAL_CLIENT_SECRET=<sandbox secret>
#    NEXT_PUBLIC_PAYPAL_CLIENT_ID=<same as PAYPAL_CLIENT_ID>
#    VISION_MOCK=1                              (no AI key needed; uses recorded AI responses in eval/fixtures)
#    or: VISION_MOCK=0 + AI_PROVIDER=google + GOOGLE_GENERATIVE_AI_API_KEY=<key>
npm run db:reset                  # creates ./data/proofpay.db, seeds 3 demo jobs
npm run dev                       # → http://localhost:3000
```

## Try it (sandbox)

**Sandbox only. No real money moves.** This is a PayPal **sandbox personal (buyer)** login for judges, not a live PayPal account. Task **A07** replaces the placeholders once that sandbox personal account exists. Do not invent a login.

| | |
|---|---|
| Sandbox buyer email | `<sandbox-buyer-email>` |
| Sandbox buyer password | `<sandbox-buyer-password>` |

Until A07 fills the table, open the PayPal Developer Dashboard → Testing Tools → Sandbox Accounts, use the default personal account, and view its password there.

### Steps (about 3 minutes)
1. Open `http://localhost:3000/?as=customer` → **New job** → e.g. "Replace bike chain", category *bike_repair*, $60 → **Create**. Review the AI checklist → **Save**.
2. Click the **PayPal** button → log in with the **sandbox buyer** in [Try it (sandbox)](#try-it-sandbox) → approve. You'll see **"Funds held by PayPal"**.
3. Open `/?as=worker` → the job → note the 4‑digit code → upload a before and an after photo (any JPEG, PNG or WebP of your own, up to 8 MB each; HEIC is not supported) → **Submit**. With `VISION_MOCK=1` the photo content is not inspected, so any two different photos work.
4. Back on `/?as=customer` → the job shows per‑criterion verdicts with boxes → **Captured** in the money timeline. Check the sandbox business account's activity to see the capture.
5. Optional: open the seeded job **Apartment deep clean** (`/jobs/demo-cleaning`): it ends in a partial result, and the customer accepts the agent's proposal ($96 of $120). For the fraud path, open **Parcel delivery to the front door** (`/jobs/demo-delivery`) and upload `eval/stock/placeholder-doorstep-1.jpg` as the after photo: the duplicate check sends it to human review → `/?as=reviewer` → reject → the hold is voided.

In mock mode (`NEXT_PUBLIC_PAYPAL_MOCK=1`) step 2 is a **Simulate PayPal approval (mock)** button; there is no PayPal login.

Hosted demo: **(URL added after the human deploys the Render blueprint)**. **Sandbox only. No real money moves.**

Other commands: `npm run check` (lint + typecheck + unit tests) · `npm run e2e` (Playwright; run `npx playwright install chromium` once first) · `npm run eval` (vision eval → `eval/report.md`).

Limitations (honest): role switching via `?as=` is a demo convenience, not authentication. On Render's free tier the SQLite DB and uploads reset on restart. The AI can be wrong, so low‑confidence or suspicious cases always go to a human.

## Screenshots

Captured by the automated demo dry-run (`E2E_DRYRUN=1 npx playwright test tests/e2e/demo-dryrun.spec.ts`); per-shot
timings, OK/glitch results, the first-navigation time and the exact commands are in
[docs/DRYRUN_REPORT.md](docs/DRYRUN_REPORT.md).

**Landing:** "Money moves when the camera says the job is done."

![Landing page](docs/img/01-landing.png)

**Customer creates the job; AI writes the photo-checkable checklist** (and the liveness code):

![Create job with the AI checklist](docs/img/02-create-job-ai-checklist.png)

**PayPal authorizes the payment — "Funds held by PayPal", not charged:**

![Funds held by PayPal](docs/img/03-funds-held.png)

**Worker view: the 4-digit liveness code and before/after evidence:**

![Worker upload with liveness code](docs/img/04-worker-upload-code.png)

**AI verification: per-criterion verdicts with evidence boxes:**

![Verification result with evidence boxes](docs/img/05-verification-boxes.png)

**Money timeline: Held $60.00 -> Verified -> Captured $60.00:**

![Captured money timeline](docs/img/06-timeline-captured.png)

**Partial result: the settlement agent proposes $96.00 / $24.00 and the customer accepts:**

![Partial settlement proposal](docs/img/07-partial-proposal.png)

**Fraud path: a reused stock photo is flagged and escalated to a human:**

![Fraud flags on a reused stock photo](docs/img/08-fraud-flags.png)

**Reviewer view: a ready-made evidence pack in markdown:**

![Reviewer evidence pack](docs/img/09-reviewer-evidence-pack.png)

---

## For judges

ProofPay is a working prototype of vision-verified escrow on **PayPal sandbox**. No real money moves. Four minutes with it:

1. **No credentials needed.** Run `npm ci && cp .env.example .env.local && npm run db:reset && npm run dev` (Node.js 22+) — the default `.env.example` has `VISION_MOCK=1`; set `PAYPAL_MOCK=1` and `NEXT_PUBLIC_PAYPAL_MOCK=1` in `.env.local` to fake PayPal too (a "Simulate PayPal approval (mock)" button appears instead of the PayPal popup).
2. **The whole loop with mocks:** `/?as=customer` → create a job → mock-approve the payment ("Funds held by PayPal") → `/?as=worker` → read the liveness code, upload before/after photos → submit → back as customer to see the per-criterion verdicts and the money timeline.
3. **Real PayPal sandbox:** put sandbox credentials in `.env.local` (`PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `NEXT_PUBLIC_PAYPAL_CLIENT_ID`) and keep `VISION_MOCK=1`; get them from https://developer.paypal.com/ → Apps & Credentials → Sandbox. The buyer login for `sandbox.paypal.com` is in [Try it (sandbox)](#try-it-sandbox).
4. **With a real vision key:** set `VISION_MOCK=0`, `GOOGLE_GENERATIVE_AI_API_KEY` (or `OPENAI_API_KEY`) and a current `LLM_MODEL`/`VLM_MODEL` id. Without a key the deterministic mock produces the same demo outcomes: bike → full capture, cleaning → partial capture ($96 of $120) approved by the customer, reused stock photo → human review.

| Switch | `1` means | Use it for |
|---|---|---|
| `VISION_MOCK` | no AI calls; deterministic verification | judges, e2e, CI |
| `PAYPAL_MOCK` | PayPal calls served by an in-memory fake (orders, authorize, capture, void, refund) | judges without sandbox creds |
| `NEXT_PUBLIC_PAYPAL_MOCK` | the UI shows a mock-approve button instead of the PayPal JS SDK | same |

Honest limitations: the `?as=` role switch is a demo convenience, not authentication; on Render's free tier the SQLite DB and uploads reset on restart; the AI can be wrong, so low-confidence or suspicious cases always go to a human. The Devpost text (with the submitted eval numbers and video link) is in [docs/DEVPOST.md](docs/DEVPOST.md).

---

## For the team (Adarsh, Collaborator, and their AI agents)

### Where things live
| What | Where |
|---|---|
| Repo | https://github.com/adarsh-nl/proofpay |
| **Task board (source of truth for status)** | Notion → **ProofPay Tasks**: https://app.notion.com/p/e1809761315044039838e9ff7bc70f02 |
| Project page (links, timeline, how to use the board) | https://app.notion.com/p/4145007c7d318100acf3ee62d7b1b521 |
| Rules for agents (ownership, commands, DoD) | [`AGENTS.md`](AGENTS.md) |
| Spec | [`docs/MANUAL.md`](docs/MANUAL.md) |
| Prompts per task | [`docs/AGENT_PROMPTS.md`](docs/AGENT_PROMPTS.md) |
| Secrets | Password manager / Signal **only** (never git, Notion, PRs or agent chats) |

### Deadlines (CET)
- **Wed 18:00**: MVP freeze (every MVP task merged)
- **Thu 15:00**: code freeze (docs only after)
- **Thu 18:00**: Devpost submitted (our target)
- **Thu 21:00**: hard deadline (= 12:00 PST)
- Adarsh is offline **Thu ~08:00–12:00** (US visa interview at 09:15)

### First 30 minutes for the Collaborator (step by step)
1. Accept the GitHub invite to `adarsh-nl/proofpay` and the Notion page share.
2. Install: Node 22+ (`node -v`), git, and Google Chrome.
3. `git clone https://github.com/adarsh-nl/proofpay.git && cd proofpay && npm ci` (after T00 has merged).
4. Get the sandbox `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET` from Adarsh via password manager → `cp .env.example .env.local` → paste them in → keep `VISION_MOCK=1`.
5. `npm run db:reset && npm run dev`, then open http://localhost:3000.
6. Read `AGENTS.md` §0–§4 and §9–§10 (15 min), then `docs/MANUAL.md` §1–§4 and §8.
7. Open Notion → ProofPay Tasks → filter `Owner = Collaborator` → start **F01** (set it to *In progress*).
8. Paste the **F01** block from `docs/AGENT_PROMPTS.md` into a Frontend lane session on the repo.

### How to do any task (humans)
```bash
git switch main && git pull --ff-only
git switch -c feat/<TaskID>-<slug>              # exact name is in the Notion row's "Branch"
# Notion: Status → In progress
# paste the prompt for <TaskID> from docs/AGENT_PROMPTS.md into the lane named in the row
npm run check                                   # must be green
git push -u origin feat/<TaskID>-<slug>
gh pr create --fill --title "[<TaskID>] <title>"   # or open the PR on GitHub
# Notion: Status → In review, paste PR URL in "Prompt link / notes"
# other human reviews → squash merge → Notion: Status → Done
```
Parallel agents on one laptop: use a worktree per task (`git worktree add ../proofpay-<TaskID> -b <branch> origin/main`) so two agents never share a working copy.

### Who works where (summary of AGENTS.md §4)
| Lane | Writes to | Never touches |
|---|---|---|
| Backend lane | `src/server/**`, `src/app/api/**`, `src/shared/**`*, `tests/unit/**`, `scripts/**` (not eval), `drizzle/**`, `render.yaml`, `.github/**` | UI, e2e, eval |
| Frontend lane | `src/app/**` (not api), `src/components/**`, `src/lib/**`, `src/styles/**`, `public/**` | server, shared, api, tests, eval |
| QA lane | `tests/e2e/**`, `eval/**`, `scripts/eval*.ts`, `playwright.config.ts`, `docs/img/**` | src/** |

\* `src/shared/**` is frozen after T01. Changes need the `contract-change` label and approval from both humans.

### Definition of Done (short)
Acceptance criteria met and quoted in the PR · `npm run check` green locally + CI · tests/screenshots attached · no secrets · only owned paths touched · docs/env updated · reviewed and merged · Notion = Done. Full list: `AGENTS.md` §10.

## Documentation index

| File | What it's for |
|---|---|
| [`docs/MANUAL.md`](docs/MANUAL.md) | Master build manual: goals, scope tiers, stack, data model, state machine, API contract, vision pipeline, PayPal integration, security, agentic layer |
| [`docs/TASKS.md`](docs/TASKS.md) | Task board: IDs, owner, lane, dependencies, estimates, acceptance criteria, timeline, file ownership |
| [`docs/AGENT_PROMPTS.md`](docs/AGENT_PROMPTS.md) | Copy‑paste starter prompts per task for the Backend, Frontend, and QA lanes |
| [`docs/COLLABORATION.md`](docs/COLLABORATION.md) | Git workflow for 2 humans + 3 agents, PR rules, sync checkpoints |
| [`docs/DEMO_AND_SUBMISSION.md`](docs/DEMO_AND_SUBMISSION.md) | 3‑minute video script, Devpost checklist, talking points, risks & fallbacks |
| [`docs/DIRECTORY_TREE.md`](docs/DIRECTORY_TREE.md) | Proposed repository layout with owners |
| [`docs/REFERENCES.md`](docs/REFERENCES.md) | Every external fact we rely on, with the source link and what still needs verifying |
| [`AGENTS.md`](AGENTS.md) | The only instruction file for humans and coding agents (Backend, Frontend, and QA lanes) |

## Built with

PayPal Orders API v2 · PayPal Payments API v2 (authorize / capture / void / reauthorize / refund) · PayPal JS SDK · PayPal Agent Toolkit · (stretch) PayPal Webhooks, Disputes API, Payouts API · Vercel AI SDK · a hosted vision-language model · Next.js · TypeScript · SQLite + Drizzle · sharp · exifr · Render · AG Grid (escrow/ledger dashboard).

## License

MIT (see `LICENSE`). Devpost requires a public repo with an open‑source licence visible in GitHub's About section.

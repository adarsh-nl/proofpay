# ProofPay — Devpost submission (draft)

> **Draft maintained by the team.** Placeholders in `{{DOUBLE_BRACES}}` are filled by a human
> before the Devpost submission: `{{HOSTED_URL}}`, `{{YOUTUBE_URL}}`, `{{EVAL_NUMBERS}}`, `{{TOOLS_USED}}`.
> This file is the source for the Devpost text form; the form itself is filled by a human.

ProofPay **uses PayPal Orders v2 (intent AUTHORIZE) and Payments v2 capture/void in the sandbox, with AI
vision verification.** It is a working prototype: money for a real-world job is held by PayPal, the result
is verified from before/after photos, and the money only moves when — and as much as — a recorded human
approval allows.

## Inspiration

On 7 November a Fitbit was marked "delivered" in Enschede and never arrived. No photo, no proof, and the
money had already moved. ProofPay flips that: the customer pays the *idea* of a finished job, the worker
proves it with photos, and PayPal holds the money in between.

## What it does

ProofPay is vision-verified escrow on PayPal.

1. A customer creates a job and PayPal **authorizes** the payment (held, not charged — Orders v2
   `intent: AUTHORIZE`). An LLM turns the job description into 3–6 photo-checkable acceptance criteria,
   plus a one-time 4-digit **liveness code**.
2. The worker uploads before/after photos with the code visible in an after photo.
3. Deterministic **forensics** (sha256/dHash duplicate and stock-image detection, EXIF time window,
   before≈after similarity, scene mismatch, screenshot detection) run alongside a **vision-language model**
   that returns a verdict, confidence and bounding-box evidence for every criterion.
4. The decision engine picks one outcome:
   - **APPROVED** → PayPal capture (full amount, `final_capture: true`);
   - **PARTIAL** → an AI settlement agent explains which criteria failed, proposes a partial capture and
     release amount, and the **customer must click accept** before money moves;
   - **REJECTED / HUMAN_REVIEW** → a reviewer sees the evidence pack and approves, sets an amount, or
     rejects and voids the hold.
5. Every status change and every PayPal call is in an append-only audit timeline, and no agent (human or AI)
   can capture more than the decision allows, without a recorded approval event.

## How we built it

- **Next.js 16 + TypeScript (strict) + Tailwind** — one app, App Router, server route handlers.
- **PayPal sandbox** — Orders v2 create/authorize, Payments v2 capture (partial, `final_capture`), void,
  refund, reauthorize; every write is idempotent via a deterministic `PayPal-Request-Id` persisted in SQLite.
- **Vercel AI SDK** structured outputs for the criteria generator, the vision verifier and the settlement
  agent; prompts live in `src/server/vision/prompts.ts`.
- **PayPal Agent Toolkit** read tools (order/dispute state) feed the evidence pack.
- **sharp + exifr** for image normalisation, dHash and EXIF; **SQLite + Drizzle** for jobs, criteria, evidence,
  payments, verifications, events and idempotency; **Render** for hosting (`render.yaml`).
- Everything runs offline in deterministic mock mode (`VISION_MOCK=1`, `PAYPAL_MOCK=1`) so judges can try it
  without any credentials: `npm ci && npm run db:reset && npm run dev`.

## Challenges / Accomplishments / What we learned / What's next

**Challenges.** PayPal's authorize/capture lifecycle has sharp edges: `final_capture` defaults to false, a
partial capture has to release the remainder exactly once, and void-after-capture must fail loudly. We made
the money path boring: one capture per authorization, deterministic request ids, and a code-level policy gate
that refuses any capture without a recorded human approval. The second hard part is honesty — a vision model
can be confidently wrong, so every verdict carries confidence and boxes, high-risk cases (duplicate photos,
missing liveness code, low confidence, scene mismatch) always escalate to a human.

**Accomplishments.** A full end-to-end loop in a weekend: authorize → before/after upload with liveness code →
forensics + VLM verdicts with boxes → decision → full capture, human-approved partial capture, or review/void;
plus an eval harness, an AI settlement agent that never moves money by itself, and an append-only money
timeline.

**What we learned.** Escrow is an `if` chain over an audit log: the interesting engineering is not the vision
call, it is the invariants around money (never capture above the authorization, never capture twice, never
move money without a recorded human approval) and making the demo runnable with zero credentials.

**What's next.** Real photo pairs for the eval set ({{EVAL_NUMBERS}}), webhook-driven reconciliation, and
payouts to the worker's sandbox account.

**Eval numbers.** `{{EVAL_NUMBERS}}` — the committed `eval/report.md` is currently a **MOCK** report: the case
skeletons are ready, but the human-shot photo pairs are still being captured (see
`docs/EVAL_SHOOT_GUIDE.md`). No accuracy claim is made in mock mode.

## Built with

`paypal`, `paypal-orders-api`, `paypal-payments-api`, `paypal-agent-toolkit`, `vercel-ai-sdk`, `nextjs`,
`typescript`, `sqlite`, `drizzle-orm`, `tailwindcss`, `sharp`, `render`

## Try it

Hosted demo: `{{HOSTED_URL}}` (sandbox only — no real money moves) — or run it locally:

```bash
git clone https://github.com/adarsh-nl/proofpay && cd proofpay
cp .env.example .env.local
# keep VISION_MOCK=1 and set PAYPAL_MOCK=1 + NEXT_PUBLIC_PAYPAL_MOCK=1 to run with no credentials
npm ci && npm run db:reset && npm run dev   # http://localhost:3000
```

The README "For judges" section has the switch-by-switch guide.

## Demo video

`{{YOUTUBE_URL}}` — < 3 minutes, screen recording of the sandbox flow (bike full capture → cleaning partial
accept → duplicate photo → human review → void).

## Tools used

`{{TOOLS_USED}}` — the AI coding tools / models used during the build are listed in the Devpost submission
form itself. Per the repo's contribution rules, tool names are not stored in the repository.

---

## Submission checklist (from `docs/DEMO_AND_SUBMISSION.md` §2)

Ticks are only where the item is verifiable in the repository; the rest are human actions listed in
`docs/human-actions/<lane>.md`.

- [x] **Project name / tagline** — ProofPay: "Money moves when the camera says the job is done."
- [x] **Text description** — this file, first lines name PayPal Orders v2 AUTHORIZE + Payments v2 capture/void.
- [ ] **Functional demo** — README run instructions are in the repo (`render.yaml`, `npm ci && npm run db:reset && npm run dev`); the hosted URL is `{{HOSTED_URL}}` (human: deploy + paste).
- [ ] **AI tools used** — provided in the Devpost form (not stored in this repo); human fills `{{TOOLS_USED}}` in the form.
- [ ] **"Built With" tags** — Devpost form: paypal, paypal-orders-api, paypal-payments-api, paypal-agent-toolkit, vercel-ai-sdk, nextjs, typescript, sqlite, render.
- [x] **Public GitHub repo + MIT licence** — https://github.com/adarsh-nl/proofpay · `LICENSE` is MIT.
- [ ] **Demo video < 3:00, public on YouTube** — `{{YOUTUBE_URL}}` (human records + uploads).
- [x] **Testing instructions** — README Quickstart (judges) + Try it (sandbox) + the three mock switches.
- [ ] **Published sandbox buyer login** — README "Try it (sandbox)" table is filled by the human with the sandbox personal account (never a live account).
- [x] **All materials in English** — yes.
- [ ] **Team members on Devpost** — human (Representative: Adarsh).
- [ ] **Sponsor prizes** — Render is entered (`render.yaml` + hosted service); AG Grid is **not** claimed (the F09 dashboard was dropped from scope, so we do not claim that sponsor).
- [ ] **Screenshot of the submitted confirmation** — human.

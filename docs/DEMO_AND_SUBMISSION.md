# Demo video and Devpost submission

**Hard deadline:** Thu 12 Nov 2026 **12:00 PM PST = 21:00 CET** · **Our target:** submitted by **18:00 CET** · Submit at https://paypalaihackathon.devpost.com/ ("Enter a Submission"; Adarsh as team Representative, Collaborator added as a teammate).

## 1. Three‑minute video script (target 2:45)

Record at 1920×1080, browser zoom 110%, sandbox banner visible. Voice‑over by Adarsh (or captions only). **No copyrighted music.** Use royalty‑free music you have the rights to, or none. Show only our own photos. Blur any house number or face.

| # | Time | Shot | Voice‑over / on‑screen text |
|---|---|---|---|
| 1 | 0:00–0:15 | Phone screenshot of a tracking page saying "Delivered", then an empty doorstep (own photo; blur personal details) | "Last Friday my parcel was marked *delivered*. It never arrived. No photo, no proof, but the money had already moved." |
| 2 | 0:15–0:30 | Landing page: "Money moves when the camera says the job is done." | "ProofPay is escrow for real‑world work: PayPal holds the payment, AI checks the proof, and only then does money move." |
| 3 | 0:30–0:55 | Customer creates "Replace bike chain, $60". The AI checklist appears (4 criteria + liveness code). Click PayPal → sandbox login → approve | "The customer describes the job; AI turns it into a checklist that can be checked from photos. PayPal **authorizes** $60: held, not charged, for up to 29 days." |
| 4 | 0:55–1:20 | Worker view: code **4821** banner; upload before/after; submit; verification spinner → green cards with boxes on the chain and the code | "The worker uploads before‑and‑after photos with a one‑time code in frame. A vision model checks every item and shows *where* it found the evidence." |
| 5 | 1:20–1:35 | Timeline: "Held $60 → Verified 5/5 → **Captured $60**" + PayPal capture ID; flip to the sandbox business account showing the transaction | "All criteria pass, so ProofPay **captures** the payment through PayPal automatically." |
| 6 | 1:35–2:05 | Cleaning job, $120: 4/5 pass, a red box on the greasy oven. Agent message: "Pay 80% ($96), release $24". Customer clicks **Accept** → partial capture | "When the job is *partly* done, our settlement agent proposes a fair split and explains it. The customer approves, and PayPal captures $96 and releases the rest. The agent can't move money without that click." |
| 7 | 2:05–2:30 | Delivery job: reused photo → red "Duplicate image (seen in another job)" + "Code not found" → HUMAN_REVIEW → reviewer opens the evidence pack → Reject → **Voided** | "Fraud checks catch reused or stock photos, wrong scenes and missing codes. The job goes to a human with a ready‑made evidence pack, and the hold is voided. The customer never pays for a parcel that never came." |
| 8 | 2:30–2:45 | Slide: architecture diagram + eval numbers ("20 test cases, 0 false captures") + Built with PayPal Orders v2 · Payments v2 · Agent Toolkit · Gemini/OpenAI · Render | "Built on PayPal's authorize‑and‑capture APIs and AI vision. Proof before payment, for every gig, repair and delivery." |

Backup plan: record each segment separately (Antigravity browser recordings, or OS screen recorder), then stitch them. If the live PayPal popup is slow, cut to the already‑approved state.

## 2. Devpost submission checklist
Verified requirements (Devpost page + Official Rules §4):
- [ ] **Project name**: ProofPay. **Tagline**: "Money moves when the camera says the job is done."
- [ ] **Text description**: features and functionality (template in §3 below). Name **PayPal** and **AI** explicitly.
- [ ] **Functional demo**: hosted Render URL **and** complete run instructions in the README (a mockup is not enough)
- [ ] **Tools used**: which AI models/services and how (Gemini/OpenAI VLM for verification, LLM for criteria + agent, Vercel AI SDK, PayPal Agent Toolkit). Also say we used Cursor, Claude Code and Antigravity to build it (be honest; the rules allow third‑party help as long as the work is ours)
- [ ] **"Built With" tags**: paypal, paypal-orders-api, paypal-payments-api, paypal-agent-toolkit, gemini/openai, vercel-ai-sdk, nextjs, typescript, sqlite, render (+ ag-grid / apimatic only if really used)
- [ ] **Public GitHub repo**: https://github.com/adarsh-nl/proofpay, **public**, all source + assets + instructions, **MIT licence detected in the About sidebar** (check GitHub shows "MIT license")
- [ ] **Demo video**: < 3:00, **public on YouTube**, link in the form, shows the app working on the device it was built for (desktop browser), no third‑party trademarks or music without permission
- [ ] **Testing instructions**: README "For judges" section. Sandbox only. Explain `VISION_MOCK=1`. Say whether we share a sandbox buyer login (**decision for Adarsh**; it's fake money, but rules suggest including test credentials)
- [ ] All materials in **English**
- [ ] Team members added on Devpost; **Representative** = Adarsh
- [ ] Optional: sponsor prize checkbox/field if the form asks (Render by default)
- [ ] Screenshot of the "submitted" confirmation saved to Notion

Judging stage 1 is pass/fail on "fits the theme and applies the required APIs". So make sure the description's first lines say **"uses PayPal Orders v2 (intent AUTHORIZE) and Payments v2 capture/void in the sandbox, with AI vision verification."**

## 3. Devpost text template
```
## Inspiration
A parcel marked "delivered" that never arrived, with no photo and no proof, while the money had already moved.

## What it does
ProofPay is vision-verified escrow on PayPal. A customer books a job and PayPal AUTHORIZES the payment (held, not charged).
The worker uploads before/after photos with a one-time liveness code. An LLM turns the job description into a checklist,
and a vision-language model checks each item and returns verdicts, confidence and bounding-box evidence. Fraud checks
(duplicate/stock image hashes, EXIF time window, before≈after, scene mismatch) run alongside it.
→ All pass: PayPal capture. → Partly done: an AI settlement agent proposes a partial capture, and the customer approves.
→ Fail/suspicious: the hold stays, a human reviewer gets an evidence pack, and the authorization is voided.

## How we built it
Next.js + TypeScript; PayPal JS SDK (intent=authorize), Orders v2 create/authorize, Payments v2 capture (partial,
final_capture), void, refund; PayPal Agent Toolkit tools in the agent; Vercel AI SDK with <model> structured outputs;
sharp/exifr for forensics; SQLite/Drizzle; deployed on Render.

## Challenges / Accomplishments / What we learned / What's next
...eval results: N cases, X% outcome accuracy, 0 false captures...
```

## 4. Talking points per judging criterion
- **Technological implementation**: real authorize → capture/partial/void lifecycle with idempotency keys; structured VLM outputs validated by zod; deterministic forensics; an eval harness with numbers.
- **Design**: three coherent roles; the money timeline makes PayPal state legible; evidence boxes make AI decisions explainable.
- **Potential impact**: gig and home services, last‑mile delivery, P2P marketplaces. It lowers disputes and protects both sides (the worker gets paid automatically when proof is good).
- **Innovation**: evidence as the trigger for capture; LLM‑written, photo‑checkable contracts; liveness codes against reused photos; an agent constrained by policy‑as‑code.
- **Presentation**: one personal story, three contrasting outcomes, under three minutes.

## 5. Risks and fallbacks
| Risk | Likelihood | Fallback |
|---|---|---|
| VLM API quota/outage or slow on stage | Med | `VISION_MOCK=1` recorded responses (record them Wed night with `npm run eval -- --record`) |
| VLM gives wrong verdicts on demo images | Med | Pick demo images from eval cases that pass reliably; keep thresholds conservative; show HUMAN_REVIEW as a *feature* |
| PayPal sandbox popup slow or failing | Low‑Med | Pre‑authorized seeded jobs; recorded segment from Wed night |
| Partial capture remainder not released as expected | Med | Verify in T05; if needed, call void after a non‑final capture, or show "remaining hold released at expiry" honestly |
| Render free instance cold start / data reset | High | Warm it up 2 min before recording; `SEED_ON_BOOT=1`; record locally if needed |
| Bounding boxes misaligned | Med | Unit‑test coordinate scaling (0–1000 → px); fallback: highlight the whole image with a caption |
| Running out of time | High | Respect the Wed 18:00 MVP freeze; stretch items are optional; the cut list is cut |
| Adarsh offline Thu morning | Certain | Collaborator owns A04/F08 and merges; video recorded Thu 12:30–15:00 |
| Secrets leaked in repo | Low | `.gitignore`, CI grep, rotate the sandbox secret immediately if leaked |

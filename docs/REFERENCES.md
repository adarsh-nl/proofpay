# References and verification log

Checked on **Tue 10 Nov 2026 (~13:15–13:30 CET)** unless noted. "Verify" means not yet confirmed against a live response or current docs. Whoever confirms one should add the observed behaviour plus the date here.

## Hackathon
| Fact | Source |
|---|---|
| Deadline **Thu 12 Nov 2026 12:00 PM PT (PST)** = **21:00 CET**. Judging 1–15 Dec; winners announced ~21 Dec | https://paypalaihackathon.devpost.com/details/dates · https://paypalaihackathon.devpost.com/rules (§1) |
| Submission requirements (text, functional demo/hosted URL or run instructions, tools used, public repo + OSS licence in About, YouTube video < 3 min, English) | https://paypalaihackathon.devpost.com/ · Rules §4 |
| Judging criteria (equal weight) + Stage One pass/fail + tie‑break order | Rules §6 |
| Prize list; 1 Grand or 1 HM + 1 Sponsor max | Rules §8 |
| Organiser tips: name PayPal + AI everywhere, give a runnable demo, hide keys | https://paypalaihackathon.devpost.com/updates/47305-two-weeks-to-go-get-your-project-checked-early |
| Announcement blog + partners | https://developer.paypal.com/community/blog/PayPal_AI_Hackathon/ |
| Must use the **PayPal sandbox**; any AI tool is allowed | Rules §4 "Project Requirements" |

## PayPal
| Topic | Source | Notes |
|---|---|---|
| Authorize & capture guide (29‑day hold, 3‑day honor period, reauthorize, capture up to 115% or +$75) | https://developer.paypal.com/docs/checkout/standard/customize/authorization/ · https://developer.paypal.com/platforms/checkout/standard/customize/auth-capture | JS SDK `&intent=authorize` |
| Orders v2 reference (create, authorize, capture, get, patch, track) | https://developer.paypal.com/docs/api/orders/v2/ | |
| Payments v2 reference (authorizations: get/capture/reauthorize/void; captures: get/refund; refunds: get) | https://developer.paypal.com/docs/api/payments/v2/ | |
| Capture request (`amount`, `final_capture`, `invoice_id`, `note_to_payer`, `soft_descriptor`) | https://developer.paypal.com/api/payments/v2/authorizations-capture · https://developer.paypal.com/api/payments/v2/definitions/capture_request | **Verify** that `final_capture:true` on a partial capture releases the remainder in the sandbox |
| v1→v2 migration: `final_capture` defaults false; void returns 204; `Prefer: return=representation` | https://developer.paypal.com/api/rest/integration/payments-api/v1-v2-migration | |
| 422 issue names (AUTHORIZATION_EXPIRED, PREVIOUSLY_CAPTURED, …) | Third‑party summary of the PayPal spec: https://deepwiki.com/paypal/paypal-rest-api-specifications/3.2-payments-api | **Verify** against live responses |
| Sandbox accounts (default business + personal; create more) | https://developer.paypal.com/tools/sandbox/accounts/ | |
| Webhook signature verification `POST /v1/notifications/verify-webhook-signature` | https://developer.paypal.com/api/webhooks/v1/verify-webhook-signature-post | |
| Webhook event names | https://developer.paypal.com/api/rest/webhooks/event-names/ | **Verify** `PAYMENT.AUTHORIZATION.VOIDED`, `CUSTOMER.DISPUTE.CREATED` |
| Disputes API (provide‑evidence multipart) | https://developer.paypal.com/api/customer-disputes/v1/disputes-provide-evidence · https://developer.paypal.com/api/disputes | How to open a sandbox dispute: **verify** |
| Payouts API | https://developer.paypal.com/api/payouts | **Verify** Payouts is enabled on the sandbox app |
| Negative testing | https://developer.paypal.com/negative-testing/values | Optional |
| Agent Toolkit (npm `@paypal/agent-toolkit`, AI SDK adapter) | https://developer.paypal.com/ai-tools/toolkit · https://www.npmjs.com/package/@paypal/agent-toolkit · https://github.com/paypal/agent-toolkit | Verify `configuration.actions` keys |
| Agent tools list (updated 29 Oct 2026): orders create/get/pay, refunds, disputes list/get/accept, invoices, subscriptions, tracking, reporting. **No void/partial capture tool** | https://developer.paypal.com/ai-tools/agent-tools | |
| PayPal MCP server (local `npx -y @paypal/mcp --tools=all`; remote sandbox `https://mcp.sandbox.paypal.com/sse`) | https://developer.paypal.com/ai-tools/mcp-server | Dev‑time tool |
| PayPal AI toolkit plugin for coding agents (Claude Code, Cursor) | https://github.com/paypal/ai-toolkit | Optional |

## Partners (only where they help)
| Partner | Use | Source |
|---|---|---|
| Render (web service; Workflows for durable tasks, TS SDK) | Deploy target (MVP); Workflows = stretch S6 | https://render.com/docs/workflows · https://render.com/docs/workflows-sdk-typescript |
| APIMatic Context Plugin (PayPal SDK context for Cursor / Claude Code: `npx context-plugins install paypal`) | Dev‑time accuracy. Claim it only if actually used | https://github.com/apimatic/context-plugins-installer · https://github.com/apimatic/plugin-marketplace · https://paypalaihackathon.devpost.com/details/apimatic |
| AG Grid / AG Studio (PayPal + AG Grid boilerplate) | Stretch F09 reviewer/ops grid | https://github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate · https://www.ag-grid.com/blog/hackathon-paypal-and-ag-studio/ |

## Tools
| Tool | Fact | Source |
|---|---|---|
| Antigravity | Editor + Agent Manager (parallel agents); browser subagent via `/browser` drives Chrome through Chrome DevTools MCP; may save `recording.webm` (not guaranteed); artifacts (plans, walkthroughs, screenshots); reads `AGENTS.md`/`GEMINI.md`/`.agents/rules/*.md` | https://antigravity.google/blog/introducing-google-antigravity · https://antigravity.google/docs/ide/browser-recordings/ · https://antigravity.google/docs/artifacts/ · https://antigravity.google/docs/rules/ |
| Claude Code | Reads `CLAUDE.md`; `@path` imports | Claude Code docs (verify) |
| Cursor | Project rules in `.cursor/rules/*.mdc` with `alwaysApply`; also reads `AGENTS.md` | Cursor docs (verify) |

## Verification log (append here)
| Date/time (CET) | Who | What was verified | Result |
|---|---|---|---|
| | | | |

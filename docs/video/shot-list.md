# Video shot list (target 2:45, hard limit under 3:00)

Source: [docs/DEMO_AND_SUBMISSION.md](../DEMO_AND_SUBMISSION.md) §1. Captions for the voice-over are in [captions.srt](captions.srt) (17 cues, last cue ends at 2:44.95). Record each shot as its own clip and stitch them; the timings below are the slots the captions are cut to.

| # | Start | End | Length | Screen | What to do on screen | Data needed |
|---|---|---|---|---|---|---|
| 1 | 0:00 | 0:15 | 15 s | Own photos | Tracking page screenshot saying "Delivered", then the empty doorstep | Own screenshot and photo, personal details blurred |
| 2 | 0:15 | 0:30 | 15 s | `/` | Landing page, slow scroll over the four steps | Sandbox badge visible in the header |
| 3 | 0:30 | 0:55 | 25 s | `/?as=customer` → `/customer/new` → `/jobs/<id>` | Create "Replace bike chain", bike_repair, $60. Show the AI checklist. Click PayPal, log in as the sandbox buyer, approve. End on "Funds held by PayPal" | Sandbox buyer login; or the seeded job `demo-bike` |
| 4 | 0:55 | 1:20 | 25 s | `/?as=worker` → `/worker/jobs/<id>` | Show the liveness code banner. Upload before and after photos. Submit. Switch to the customer view: verdict cards with boxes | Bike before/after photos with the code written on paper in the after photo |
| 5 | 1:20 | 1:35 | 15 s | `/jobs/<id>` timeline, then the PayPal sandbox business account | Timeline "Held $60 → Verified → Captured $60" with the capture id; then the same transaction in the sandbox account activity | Sandbox business login in a second tab, already signed in |
| 6 | 1:35 | 2:05 | 30 s | `/jobs/demo-cleaning` | 4 of 5 pass, the oven item fails. Agent proposal "capture $96, release $24". Click **Accept proposal**. Timeline shows Captured $96 | Seeded job `demo-cleaning`, already authorized and submitted before recording |
| 7 | 2:05 | 2:30 | 25 s | `/jobs/demo-delivery` → `/?as=reviewer` → `/reviewer` | Duplicate-photo flag, job in human review. Reviewer opens the job, generates the evidence pack, rejects. Status **Voided** | Seeded job `demo-delivery`; upload `eval/stock/placeholder-doorstep-1.jpg` (or the real stock photo) as the after photo before recording |
| 8 | 2:30 | 2:45 | 15 s | Slide | Architecture diagram, eval numbers from `eval/report.md`, "Built with PayPal Orders v2 · Payments v2 · Agent Toolkit · AI vision · Render" | Final eval numbers. Do not quote numbers from a report labelled MOCK |

Total: 165 s (2:45). Leave at most 10 s of slack; the upload must be under 3:00.

## Per-shot notes

- **Shot 3**: if the PayPal popup is slow, cut from the click straight to the approved state. Keep the words "PayPal" and "sandbox" on screen at least once.
- **Shot 4**: the liveness code is random per job. Write the code shown in the banner on paper before taking the after photo, or record this shot in one take.
- **Shot 6**: the customer's click is the point of the shot. Keep the cursor on **Accept proposal** for a beat before clicking.
- **Shot 7**: the reviewer console asks for the passcode on the hosted demo if `REVIEWER_PASSCODE` is set. Enter it before recording so the prompt is not in the clip.
- **Shot 8**: say "PayPal" and "AI" out loud; the organisers ask for both to be named in the video.

## Cut list if the edit runs long

1. Shorten shot 2 to 10 s.
2. Drop the sandbox business account tab from shot 5.
3. Shorten shot 8 to 10 s (keep the eval number and the PayPal line).

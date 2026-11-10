# Recording checklist

## Before recording

- [ ] Screen resolution 1920×1080, browser window maximised, browser zoom 110%.
- [ ] Clean browser profile: no bookmarks bar, no extensions in the toolbar, no other tabs with personal content, notifications off (Do Not Disturb).
- [ ] The "PayPal Sandbox" badge is visible in the app header in every app shot.
- [ ] Hosted demo: open the Render URL 2 minutes before recording so the instance is warm, and check `/api/health` returns `"ok": true`.
- [ ] Fresh demo data: the three seeded jobs (`demo-bike`, `demo-cleaning`, `demo-delivery`) are in `CREATED`. Locally run `npm run db:reset`; on Render restart the service (it reseeds on boot).
- [ ] PayPal sandbox buyer and business accounts are signed in, each in its own tab or window, and the buyer has enough balance.
- [ ] Photos ready on the recording machine: bike before/after (code on paper in the after photo), cleaning before/after, and the reused or stock doorstep photo.
- [ ] No faces, no readable house numbers, no licence plates, no names or addresses in any photo or screenshot. Blur them if present.
- [ ] No real PayPal account, card number, API key or `.env.local` content on screen at any time.

## While recording

- [ ] Record each of the eight shots in [shot-list.md](shot-list.md) as a separate clip.
- [ ] Move the cursor slowly and pause on each button for a beat before clicking.
- [ ] Shot 3: the screen shows the PayPal approval and then "Funds held by PayPal".
- [ ] Shot 5: the capture id is readable for at least two seconds.
- [ ] Shot 6: the **Accept proposal** click is on screen.
- [ ] Shot 7: the duplicate flag, the evidence pack and the final "Voided" status are all on screen.
- [ ] Keep a backup recording of every flow in `docs/recordings/` (git-ignored; do not commit files over 10 MB).

## Audio and captions

- [ ] Voice-over follows the lines in `docs/DEMO_AND_SUBMISSION.md` §1; [captions.srt](captions.srt) matches those lines and the shot timings.
- [ ] No copyrighted music. Use no music, or music you hold the rights to.
- [ ] "PayPal" and "AI" are both said out loud and shown on screen.

## Before uploading

- [ ] Final length is under 3:00 (target 2:45).
- [ ] No third-party trademarks or logos other than PayPal product names used to describe the integration.
- [ ] Export 1080p; check the captions are in sync after the edit (re-time `captions.srt` if a shot was shortened).
- [ ] Upload to YouTube as **Public**, upload `captions.srt` as English subtitles, and open the link in a private window to confirm it plays without signing in.
- [ ] Paste the link into the Devpost form and into `docs/DEVPOST.md` (replace the `{{YOUTUBE_URL}}` placeholder).

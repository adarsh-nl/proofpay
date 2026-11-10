# API examples (curl)

One example per route in `docs/MANUAL.md` §8. Run the app with the mock switches so no credentials are needed:

```bash
cp .env.example .env.local   # then set PAYPAL_MOCK=1, NEXT_PUBLIC_PAYPAL_MOCK=1, VISION_MOCK=1
npm run db:reset && npm run dev
```

Conventions:

- `BASE=http://localhost:3000`, `JOB=<job id>` (seeded ids: `demo-bike`, `demo-cleaning`, `demo-delivery`).
- The role is the cookie `pp_role` (`customer`, `worker` or `reviewer`). It is a demo role switch, not authentication.
- Errors are always `{ "error": { "code": "...", "message": "...", "details": ... } }` with a 4xx/5xx status:
  400 validation, 403 wrong role / missing approval / missing passcode, 404 not found, 409 wrong job state,
  413 file too large, 502 PayPal error (`code` is the PayPal issue, `details.debugId` is the PayPal debug id).
- If `REVIEWER_PASSCODE` is set, reviewer routes also need `-H "x-reviewer-passcode: <passcode>"`.

```bash
BASE=http://localhost:3000
JOB=demo-bike
```

## Health and role

```bash
# 21. Health → {"ok":true,"mockVision":true,"mockPaypal":true,"paypalEnv":"sandbox"}
curl -s $BASE/api/health

# Set the role cookie (the UI does this for /?as=<role>) → {"role":"worker"} + Set-Cookie: pp_role=worker
curl -s -c cookies.txt -X POST $BASE/api/role -H 'content-type: application/json' -d '{"role":"worker"}'
```

## Jobs

```bash
# 1. Create a job (customer) → 201 {"job":{...,"status":"CREATED","criteria":[...]}}
curl -s -X POST $BASE/api/jobs -b pp_role=customer -H 'content-type: application/json' \
  -d '{"title":"Replace bike chain","description":"Fit a new chain and lubricate it.","category":"bike_repair","amount":{"currency":"USD","value":"60.00"}}'

# 2. List jobs → {"jobs":[{"id","title","status","amount","updatedAt"}]}
curl -s $BASE/api/jobs

# 3. Job detail → {"job":{...}}. livenessCode is only present for the worker and reviewer roles.
curl -s $BASE/api/jobs/$JOB -b pp_role=worker

# 4. Replace the checklist (customer, only while CREATED) → {"job":{...}}
#    Weights are re-normalised to sum to 1. The system liveness criterion (cL) is always kept.
curl -s -X PUT $BASE/api/jobs/$JOB/criteria -b pp_role=customer -H 'content-type: application/json' \
  -d '{"criteria":[{"id":"c1","label":"Chain is new and seated on the sprockets","howToVerify":"Look at the chain.","required":true,"weight":0.6,"phase":"after","source":"user"},{"id":"c2","label":"Work area left tidy","howToVerify":"Look at the floor.","required":false,"weight":0.4,"phase":"after","source":"user"}]}'
```

## PayPal hold

```bash
# 5. Create the PayPal order (intent AUTHORIZE) → 201 {"orderId":"..."}
ORDER=$(curl -s -X POST $BASE/api/paypal/orders -b pp_role=customer -H 'content-type: application/json' \
  -d "{\"jobId\":\"$JOB\"}" | sed -E 's/.*"orderId":"([^"]+)".*/\1/')

# 6. Authorize it (after the buyer approved it in the PayPal popup; with PAYPAL_MOCK=1 no approval is needed)
#    → {"job":{...,"status":"AUTHORIZED","payment":{"authorizationId","expiresAt","honorPeriodEndsAt",...}}}
curl -s -X POST $BASE/api/paypal/orders/$ORDER/authorize -b pp_role=customer -H 'content-type: application/json' \
  -d "{\"jobId\":\"$JOB\"}"
```

## Evidence

```bash
# 7. Upload photos (worker; multipart; phase=before|after; up to 4 files per phase, 8 MB each, jpeg/png/webp)
#    → 201 {"evidence":[{"id","phase","sha256","dhash","width","height","url",...}]}
curl -s -X POST $BASE/api/jobs/$JOB/evidence -b pp_role=worker -F phase=before -F files=@before.jpg
curl -s -X POST $BASE/api/jobs/$JOB/evidence -b pp_role=worker -F phase=after -F files=@after.jpg

# List the uploaded evidence in upload order → {"evidence":[...]}
curl -s $BASE/api/jobs/$JOB/evidence

# 8. Delete one photo before submitting → 204
curl -s -o /dev/null -w '%{http_code}\n' -X DELETE $BASE/api/jobs/$JOB/evidence/<evidenceId> -b pp_role=worker

# 9. Submit (needs at least one after photo) → 202 {"job":{...,"status":"EVIDENCE_SUBMITTED"}}
#    Verification runs in-process; poll GET /api/jobs/$JOB until the status leaves VERIFYING.
curl -s -X POST $BASE/api/jobs/$JOB/submit -b pp_role=worker -H 'content-type: application/json' -d '{}'

# 20. Fetch a stored image (re-encoded JPEG, no EXIF/GPS)
curl -s -o after_1.jpg $BASE/api/uploads/$JOB/after_1.jpg
```

## Settlement

```bash
# 11. Customer accepts the agent's partial-capture proposal → {"job":{...,"status":"CAPTURED"}}
#     proposalId comes from the latest AGENT_MESSAGE event in job.events.
curl -s -X POST $BASE/api/jobs/$JOB/settlement/accept -b pp_role=customer -H 'content-type: application/json' \
  -d '{"proposalId":"prp_..."}'

# 12. Customer or worker declines it → {"job":{...,"status":"HUMAN_REVIEW"}}
curl -s -X POST $BASE/api/jobs/$JOB/settlement/decline -b pp_role=customer -H 'content-type: application/json' \
  -d '{"proposalId":"prp_...","reason":"The oven was cleaned too."}'

# 14. Release the hold (customer or reviewer; job must be AUTHORIZED or REJECTED) → {"job":{...,"status":"VOIDED"}}
curl -s -X POST $BASE/api/jobs/$JOB/void -b pp_role=customer -H 'content-type: application/json' \
  -d '{"reason":"Job cancelled before work started"}'
```

## Reviewer

```bash
# 17. Review queue (jobs in HUMAN_REVIEW) → {"jobs":[...]}
curl -s $BASE/api/review-queue -b pp_role=reviewer

# 13. Decision on a HUMAN_REVIEW job → {"job":{...}}
#     APPROVE → full capture (CAPTURED); PARTIAL + amount → partial capture (CAPTURED); REJECT → void (VOIDED)
curl -s -X POST $BASE/api/jobs/$JOB/review -b pp_role=reviewer -H 'content-type: application/json' \
  -d '{"decision":"PARTIAL","amount":{"currency":"USD","value":"40.00"},"notes":"Two of three items done."}'

# 15. Refund a captured payment (omit amount for a full refund) → {"job":{...,"status":"REFUNDED"}}
curl -s -X POST $BASE/api/jobs/$JOB/refund -b pp_role=reviewer -H 'content-type: application/json' \
  -d '{"amount":{"currency":"USD","value":"10.00"},"reason":"Goodwill refund"}'
```

Routes 10 (`POST /api/jobs/:id/verify`), 16 (`reauthorize`), 18 (`agent/evidence-pack`) and 19 (`webhooks/paypal`) are added by tasks T13, T17, T14 and T16.

#!/usr/bin/env bash
# Fresh-clone judge test (task A06).
#
# Clones the repository into a temporary folder and follows the README
# quickstart literally, in full mock mode (no PayPal or AI credentials):
# install → env → db:reset → build → start → health → happy path over the API
# (create job → hold → upload photos → submit → CAPTURED).
# If tests/e2e/happy.spec.ts exists and RUN_E2E=1, the Playwright happy path
# is also run against the same server.
#
# Usage:  bash eval/judge-test.sh
# Env:    REPO_URL  (default: the public GitHub repo)   REF (default: main)
#         PORT      (default: 3111)                     KEEP=1 keeps the clone
#         WORK_DIR  (default: mktemp)                   RUN_E2E=1
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/adarsh-nl/proofpay.git}"
REF="${REF:-main}"
PORT="${PORT:-3111}"
WORK_DIR="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/proofpay-judge.XXXXXX")}"
BASE="http://localhost:${PORT}"
SERVER_PID=""

step() { printf '\n== %s\n' "$*"; }
fail() { printf '\nJUDGE TEST FAILED: %s\n' "$*" >&2; exit 1; }

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  if [ "${KEEP:-0}" != "1" ]; then rm -rf "$WORK_DIR"; else echo "kept: $WORK_DIR"; fi
}
trap cleanup EXIT

# json <file> <js expression over `d`>  → prints the value
json() { node -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const v=eval(process.argv[2]);console.log(v===undefined?"":v)' "$1" "$2"; }

# call <name> <expected status> <curl args...>  → body in $WORK_DIR/<name>.json
call() {
  local name="$1" expected="$2"; shift 2
  local code
  code="$(curl -sS -o "$WORK_DIR/$name.json" -w '%{http_code}' "$@")"
  if [ "$code" != "$expected" ]; then
    echo "--- $name response:"; head -c 600 "$WORK_DIR/$name.json" || true; echo
    fail "$name returned HTTP $code, expected $expected"
  fi
  echo "ok  $name ($code)"
}

step "Requirements"
node -v; npm -v; git --version
node -e 'process.exit(Number(process.versions.node.split(".")[0])>=22?0:1)' || fail "Node.js 22 or newer is required"

step "Clone $REPO_URL ($REF) into $WORK_DIR"
git clone --quiet --depth 1 --branch "$REF" "$REPO_URL" "$WORK_DIR/proofpay"
cd "$WORK_DIR/proofpay"

step "npm ci"
npm ci --no-fund --no-audit

step "Environment (.env.local, mock mode: no credentials)"
cp .env.example .env.local
node -e '
const fs=require("fs");let s=fs.readFileSync(".env.local","utf8");
for (const k of ["PAYPAL_MOCK","NEXT_PUBLIC_PAYPAL_MOCK","VISION_MOCK"]) {
  s = new RegExp("^"+k+"=","m").test(s) ? s.replace(new RegExp("^"+k+"=.*$","m"), k+"=1") : s+"\n"+k+"=1\n";
}
fs.writeFileSync(".env.local", s);'

step "npm run db:reset"
npm run db:reset

step "npm run build"
NEXT_TELEMETRY_DISABLED=1 npm run build

step "npm start (port $PORT)"
PORT="$PORT" NEXT_TELEMETRY_DISABLED=1 npm start > "$WORK_DIR/server.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 90); do
  curl -sf "$BASE/api/health" > "$WORK_DIR/health.json" 2>/dev/null && break
  kill -0 "$SERVER_PID" 2>/dev/null || { tail -20 "$WORK_DIR/server.log"; fail "server exited"; }
  sleep 2
done
[ -s "$WORK_DIR/health.json" ] || { tail -20 "$WORK_DIR/server.log"; fail "health check never answered"; }
cat "$WORK_DIR/health.json"; echo
[ "$(json "$WORK_DIR/health.json" 'd.ok && d.mockPaypal && d.mockVision')" = "true" ] || fail "health is not ok / not in mock mode"

step "Pages"
# <url path>:<page file>; a page that is not in this checkout yet is skipped, not failed.
for entry in "/:src/app/page.tsx" "/customer/new:src/app/customer/new/page.tsx" \
  "/jobs/demo-bike:src/app/jobs/[id]/page.tsx" "/worker/jobs/demo-bike:src/app/worker/jobs/[id]/page.tsx" \
  "/reviewer:src/app/reviewer/page.tsx"; do
  path="${entry%%:*}"; file="${entry#*:}"
  if [ ! -f "$file" ]; then echo "skip GET $path ($file is not in this checkout)"; continue; fi
  code="$(curl -s -o /dev/null -w '%{http_code}' "$BASE$path")"
  [ "$code" = "200" ] || fail "GET $path returned $code"
  echo "ok  GET $path"
done

step "Happy path over the API (bike chain, 60.00 USD)"
node -e '
const sharp=require("sharp");
function img(seed,file){const w=32,h=32,b=Buffer.alloc(w*h);let x=seed;for(let i=0;i<b.length;i++){x=(x*1103515245+12345)&0x7fffffff;b[i]=x%256}
  return sharp(b,{raw:{width:w,height:h,channels:1}}).resize(800,600,{kernel:"nearest"}).jpeg({quality:85}).toFile(file)}
Promise.all([img(11,process.argv[1]+"/before.jpg"),img(29,process.argv[1]+"/after.jpg")]).catch(e=>{console.error(e);process.exit(1)})' "$WORK_DIR"

JSON=(-H 'content-type: application/json')
call create 201 -X POST "$BASE/api/jobs" -b pp_role=customer "${JSON[@]}" \
  -d '{"title":"Replace bike chain","description":"Fit a new chain and lubricate the drivetrain.","category":"bike_repair","amount":{"currency":"USD","value":"60.00"}}'
JOB="$(json "$WORK_DIR/create.json" 'd.job.id')"
[ "$(json "$WORK_DIR/create.json" 'd.job.status')" = "CREATED" ] || fail "new job is not CREATED"

call order 201 -X POST "$BASE/api/paypal/orders" -b pp_role=customer "${JSON[@]}" -d "{\"jobId\":\"$JOB\"}"
ORDER="$(json "$WORK_DIR/order.json" 'd.orderId')"
call authorize 200 -X POST "$BASE/api/paypal/orders/$ORDER/authorize" -b pp_role=customer "${JSON[@]}" -d "{\"jobId\":\"$JOB\"}"
[ "$(json "$WORK_DIR/authorize.json" 'd.job.status')" = "AUTHORIZED" ] || fail "job is not AUTHORIZED"

call worker 200 "$BASE/api/jobs/$JOB" -b pp_role=worker
json "$WORK_DIR/worker.json" '/^\d{4}$/.test(d.job.livenessCode)' | grep -q true || fail "worker does not see a 4-digit liveness code"

call before 201 -X POST "$BASE/api/jobs/$JOB/evidence" -b pp_role=worker -F phase=before -F "files=@$WORK_DIR/before.jpg"
call after 201 -X POST "$BASE/api/jobs/$JOB/evidence" -b pp_role=worker -F phase=after -F "files=@$WORK_DIR/after.jpg"
call submit 202 -X POST "$BASE/api/jobs/$JOB/submit" -b pp_role=worker "${JSON[@]}" -d '{}'

STATUS=""
for _ in $(seq 1 30); do
  call job 200 "$BASE/api/jobs/$JOB" -b pp_role=customer > /dev/null
  STATUS="$(json "$WORK_DIR/job.json" 'd.job.status')"
  case "$STATUS" in EVIDENCE_SUBMITTED|VERIFYING) sleep 2 ;; *) break ;; esac
done
echo "final status: $STATUS, captured: $(json "$WORK_DIR/job.json" 'd.job.payment.captured.value')"
[ "$STATUS" = "CAPTURED" ] || fail "expected CAPTURED, got $STATUS"
[ "$(json "$WORK_DIR/job.json" 'd.job.payment.captured.value')" = "60.00" ] || fail "captured amount is not 60.00"
[ "$(json "$WORK_DIR/job.json" 'd.job.payment.captureIds.length')" = "1" ] || fail "expected exactly one capture id"

if [ "${RUN_E2E:-0}" = "1" ] && [ -f tests/e2e/happy.spec.ts ]; then
  step "Playwright happy path"
  npx playwright install chromium
  npm run e2e -- happy
fi

printf '\nJUDGE TEST PASSED (fresh clone of %s@%s, mock mode)\n' "$REPO_URL" "$REF"

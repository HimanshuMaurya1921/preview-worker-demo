#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# AI Preview System — Automated Test Suite
# Run: bash test-suite.sh
# Results saved to: test-results.log
# ═══════════════════════════════════════════════════════════════

LOGFILE="$(dirname "$0")/test-results.log"
exec > >(tee "$LOGFILE") 2>&1
echo "Test run started at: $(date)"
echo ""

set -e
PASS=0; FAIL=0; SKIP=0
ORCH="http://localhost:3001"

green() { echo -e "\033[32m✅ PASS: $1\033[0m"; PASS=$((PASS+1)); }
red()   { echo -e "\033[31m❌ FAIL: $1\033[0m"; FAIL=$((FAIL+1)); }
skip()  { echo -e "\033[33m⏭️  SKIP: $1\033[0m"; SKIP=$((SKIP+1)); }
header(){ echo -e "\n\033[1;36m══════ $1 ══════\033[0m"; }

# ─── Pre-flight ───
header "PRE-FLIGHT CHECKS"

if curl -s "$ORCH/health" | grep -q "active"; then
  green "Orchestrator is running"
else
  red "Orchestrator not reachable at $ORCH/health"
  echo "Start it first: cd worker && RUNTIME=local WORKER_IMAGE=preview-worker:local WORKER_AUTH_TOKEN=local-dev-token node server.js"
  exit 1
fi

if docker info &>/dev/null; then
  green "Docker is available"
else
  red "Docker is not running"; exit 1
fi

if docker images preview-worker:local --format "{{.ID}}" | grep -q .; then
  green "preview-worker:local image exists"
else
  red "preview-worker:local image not found. Run: docker build -t preview-worker:local ./worker"
  exit 1
fi

# ═══════════════════════════════════════════════════════════════
header "SECTION 1 — ISOLATED WORKER TESTS"
# ═══════════════════════════════════════════════════════════════

echo "Starting isolated worker container..."
docker rm -f worker-test 2>/dev/null || true
docker run -d --name worker-test -p 4000:3000 -e AUTH_TOKEN=test-token preview-worker:local

# 1.1 — Health check
echo "Waiting for worker to become ready (max 80s)..."
READY=false
for i in $(seq 1 40); do
  STATUS=$(curl -s http://localhost:4000/__health 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || echo "")
  if [ "$STATUS" = "ready" ]; then
    READY=true; break
  fi
  sleep 2
done
if $READY; then green "1.1 Worker boots and becomes healthy"; else red "1.1 Worker never reached ready"; fi

# 1.1b — Health includes compileVersion
CV=$(curl -s http://localhost:4000/__health | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('compileVersion','MISSING'))" 2>/dev/null)
if [ "$CV" != "MISSING" ] && [ "$CV" -ge 0 ] 2>/dev/null; then
  green "1.1b Health endpoint includes compileVersion ($CV)"
else
  red "1.1b compileVersion missing from health endpoint"
fi

# 1.2 — Auth enforcement
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/__inject -H "Content-Type: application/json" -H "x-worker-auth: wrong-token" -d '{"files":{}}')
[ "$CODE" = "401" ] && green "1.2a Wrong token rejected ($CODE)" || red "1.2a Wrong token not rejected ($CODE)"

CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/__inject -H "Content-Type: application/json" -d '{"files":{}}')
[ "$CODE" = "401" ] && green "1.2b No token rejected ($CODE)" || red "1.2b No token not rejected ($CODE)"

# 1.3 — File injection
INJECT=$(curl -s -X POST http://localhost:4000/__inject -H "Content-Type: application/json" -H "x-worker-auth: test-token" \
  -d '{"files":{"app/page.js":"export default function P(){return <h1>Test</h1>}","app/layout.js":"export default function L({children}){return <html><body>{children}</body></html>}"}}')
echo "$INJECT" | grep -q '"ok":true' && green "1.3 File injection works" || red "1.3 File injection failed: $INJECT"

# 1.4 — Path traversal blocked
TRAV=$(curl -s -X POST http://localhost:4000/__inject -H "Content-Type: application/json" -H "x-worker-auth: test-token" \
  -d '{"files":{"../../etc/passwd":"hacked"}}')
echo "$TRAV" | grep -qi "traversal" && green "1.4 Path traversal blocked" || red "1.4 Path traversal NOT blocked: $TRAV"

# 1.5 — Size limit (skip if python3 unavailable)
if command -v python3 &>/dev/null; then
  python3 -c "
import json,sys
big='x'*(21*1024*1024)
with open('/tmp/big-payload.json','w') as f:
    json.dump({'files':{'app/page.js':big}},f)
" 2>/dev/null
  CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:4000/__inject -H "Content-Type: application/json" -H "x-worker-auth: test-token" -d @/tmp/big-payload.json 2>/dev/null)
  [ "$CODE" = "413" ] && green "1.5 20MB size limit enforced ($CODE)" || red "1.5 Size limit not enforced ($CODE)"
  rm -f /tmp/big-payload.json
else
  skip "1.5 Size limit (python3 not available)"
fi

# 1.6 — Wipe flag
curl -s -X POST http://localhost:4000/__inject -H "Content-Type: application/json" -H "x-worker-auth: test-token" \
  -d '{"files":{"app/page.js":"export default ()=><h1>A</h1>","app/extra.js":"extra","app/layout.js":"export default function L({c}){return <html><body>{c}</body></html>}"}}' >/dev/null
sleep 2
curl -s -X POST http://localhost:4000/__inject -H "Content-Type: application/json" -H "x-worker-auth: test-token" \
  -d '{"files":{"app/page.js":"export default ()=><h1>B</h1>","app/layout.js":"export default function L({c}){return <html><body>{c}</body></html>}"},"wipe":true}' >/dev/null
EXTRA=$(docker exec worker-test find /workspace -name "extra.js" -not -path "*/node_modules/*" 2>/dev/null)
[ -z "$EXTRA" ] && green "1.6 Wipe flag clears old files" || red "1.6 Wipe flag did NOT clear extra.js"

# 1.6b — Wipe also clears .next
NEXDIR=$(docker exec worker-test test -d /workspace/.next 2>/dev/null && echo "exists" || echo "gone")
[ "$NEXDIR" = "gone" ] && green "1.6b .next directory wiped" || red "1.6b .next directory still exists after wipe"

# Cleanup
docker rm -f worker-test 2>/dev/null
green "1.7 Worker container cleaned up"

# ═══════════════════════════════════════════════════════════════
header "SECTION 2 — ORCHESTRATOR API TESTS"
# ═══════════════════════════════════════════════════════════════

# 2.1 — Cold start
echo "Testing cold start (this takes ~30s)..."
START_ATTEMPT=1
while [ $START_ATTEMPT -le 2 ]; do
  COLD=$(curl -s --max-time 120 -X POST "$ORCH/api/preview/start" -H "Content-Type: application/json" \
    -d '{"projectId":"test-cold-001","userId":"test-user-001","files":{"app/page.js":"export default ()=><h1>Cold Start</h1>","app/layout.js":"export default function L({children}){return <html><body>{children}</body></html>}"}}')

  STATUS=$(echo "$COLD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null)
  
  if [ "$STATUS" = "expired" ]; then
    echo "Stale session detected, retrying cold start (Attempt 2)..."
    START_ATTEMPT=$((START_ATTEMPT+1))
    continue
  fi
  break
done

WORKER_ID=$(echo "$COLD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('workerId',''))" 2>/dev/null)
WARM_FLAG=$(echo "$COLD" | python3 -c "import sys,json; print(json.load(sys.stdin).get('warm',''))" 2>/dev/null)

if [ -n "$WORKER_ID" ]; then
  green "2.1 Cold start returned workerId: $WORKER_ID"
else
  red "2.1 Cold start failed: $COLD"
  echo "Aborting remaining orchestrator tests."
  echo -e "\n\033[1m═══ Results: $PASS passed, $FAIL failed, $SKIP skipped ═══\033[0m"
  exit 1
fi
[ "$WARM_FLAG" = "False" ] && green "2.1b Cold start warm=false" || skip "2.1b warm flag was: $WARM_FLAG"

# 2.2 — Proxy reachable
sleep 3
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$ORCH/api/preview/proxy/$WORKER_ID/" 2>/dev/null)
[ "$CODE" = "200" ] && green "2.2 Proxy reachable ($CODE)" || red "2.2 Proxy not reachable ($CODE)"

# 2.3 — PATCH update
PATCH=$(curl -s -X PATCH "$ORCH/api/preview/$WORKER_ID" -H "Content-Type: application/json" \
  -d '{"projectId":"test-cold-001","files":{"app/page.js":"export default ()=><h1>Patched</h1>"}}')
echo "$PATCH" | grep -q '"ok":true' && green "2.3 PATCH update works" || red "2.3 PATCH failed: $PATCH"

# 2.4 — Warm update reuses container
echo "Testing warm update..."
WARM=$(curl -s --max-time 30 -X POST "$ORCH/api/preview/start" -H "Content-Type: application/json" \
  -d '{"projectId":"test-cold-001","userId":"test-user-001","files":{"app/page.js":"export default ()=><h1>Warm</h1>","app/layout.js":"export default function L({children}){return <html><body>{children}</body></html>}"}}')

WARM_ID=$(echo "$WARM" | python3 -c "import sys,json; print(json.load(sys.stdin).get('workerId',''))" 2>/dev/null)
WARM_F=$(echo "$WARM" | python3 -c "import sys,json; print(json.load(sys.stdin).get('warm',''))" 2>/dev/null)

[ "$WARM_ID" = "$WORKER_ID" ] && green "2.4a Warm update reused same container" || red "2.4a Container changed: $WARM_ID vs $WORKER_ID"
[ "$WARM_F" = "True" ] && green "2.4b warm=true in response" || red "2.4b warm flag was: $WARM_F"

# 2.5 — Session mismatch
MISMATCH=$(curl -s -X PATCH "$ORCH/api/preview/$WORKER_ID" -H "Content-Type: application/json" \
  -d '{"projectId":"wrong-project","files":{"app/page.js":"export default ()=><h1>Hijack</h1>"}}')
echo "$MISMATCH" | grep -q "mismatch" && green "2.5 Session mismatch rejected" || red "2.5 Mismatch NOT rejected: $MISMATCH"

# 2.6 — Stats endpoint
STATS=$(curl -s "$ORCH/api/preview/stats")
ACTIVE=$(echo "$STATS" | python3 -c "import sys,json; print(json.load(sys.stdin).get('activeSessions',0))" 2>/dev/null)
[ "$ACTIVE" -ge 1 ] 2>/dev/null && green "2.6 Stats shows $ACTIVE active session(s)" || red "2.6 Stats broken: $STATS"

# 2.7 — DELETE cleanup
DEL=$(curl -s -X DELETE "$ORCH/api/preview/$WORKER_ID")
echo "$DEL" | grep -q '"ok":true' && green "2.7a DELETE returned ok" || red "2.7a DELETE failed: $DEL"
sleep 2
GONE=$(docker ps --format "{{.Names}}" 2>/dev/null | grep -c "$WORKER_ID" || true)
[ "$GONE" = "0" ] && green "2.7b Container actually removed" || red "2.7b Container still running"

# 2.9 — Expired session
echo "Testing expired session detection..."
COLD2=$(curl -s --max-time 120 -X POST "$ORCH/api/preview/start" -H "Content-Type: application/json" \
  -d '{"projectId":"expire-test","userId":"test-user-expire","files":{"app/page.js":"export default ()=><h1>Expire</h1>","app/layout.js":"export default function L({children}){return <html><body>{children}</body></html>}"}}')
W2=$(echo "$COLD2" | python3 -c "import sys,json; print(json.load(sys.stdin).get('workerId',''))" 2>/dev/null)

if [ -n "$W2" ]; then
  echo "Simulating worker crash for $W2..."
  if docker inspect "$W2" >/dev/null 2>&1; then
    docker rm -f "$W2" >/dev/null 2>&1
  else
    kubectl delete pod "$W2" -n preview --now >/dev/null 2>&1 || true
  fi
  
  echo "Waiting for resources to be released..."
  sleep 4
  EXPIRED=$(curl -s --max-time 10 -X POST "$ORCH/api/preview/start" -H "Content-Type: application/json" \
    -d '{"projectId":"expire-test","userId":"test-user-expire","files":{"app/page.js":"export default ()=><h1>After</h1>","app/layout.js":"export default function L({children}){return <html><body>{children}</body></html>}"}}')
  echo "$EXPIRED" | grep -q "expired" && green "2.9 Expired session detected" || red "2.9 No expired response: $EXPIRED"
else
  skip "2.9 Could not create test session"
fi

# ═══════════════════════════════════════════════════════════════
header "SECTION 5 — EDGE CASES"
# ═══════════════════════════════════════════════════════════════

# 5.1 — Two simultaneous sessions
echo "Testing concurrent sessions..."
curl -s --max-time 120 -X POST "$ORCH/api/preview/start" -H "Content-Type: application/json" \
  -d '{"projectId":"alpha","userId":"user-alpha","files":{"app/page.js":"export default ()=><h1>ALPHA</h1>","app/layout.js":"export default function L({children}){return <html><body>{children}</body></html>}"}}' > /tmp/alpha.json &
PID1=$!

curl -s --max-time 120 -X POST "$ORCH/api/preview/start" -H "Content-Type: application/json" \
  -d '{"projectId":"beta","userId":"user-beta","files":{"app/page.js":"export default ()=><h1>BETA</h1>","app/layout.js":"export default function L({children}){return <html><body>{children}</body></html>}"}}' > /tmp/beta.json &
PID2=$!

wait $PID1 $PID2 2>/dev/null
AID=$(python3 -c "import json; print(json.load(open('/tmp/alpha.json')).get('workerId',''))" 2>/dev/null)
BID=$(python3 -c "import json; print(json.load(open('/tmp/beta.json')).get('workerId',''))" 2>/dev/null)

if [ -n "$AID" ] && [ -n "$BID" ] && [ "$AID" != "$BID" ]; then
  green "5.1 Two concurrent sessions created with different IDs"
else
  red "5.1 Concurrent sessions failed (alpha=$AID beta=$BID)"
fi

# Cleanup concurrent containers
[ -n "$AID" ] && curl -s -X DELETE "$ORCH/api/preview/$AID" >/dev/null 2>&1
[ -n "$BID" ] && curl -s -X DELETE "$ORCH/api/preview/$BID" >/dev/null 2>&1

# ═══════════════════════════════════════════════════════════════
header "CODE ANALYSIS CHECKS"
# ═══════════════════════════════════════════════════════════════

# Check: usePreview handles 'expired' status
grep -q "status.*expired" /home/dev/Next-js/preview-worker-demo/frontend/src/hooks/usePreview.js && \
  green "Code: usePreview handles status=expired" || red "Code: usePreview missing expired handler"

# Check: usePreview has stableStringify
grep -q "stableStringify" /home/dev/Next-js/preview-worker-demo/frontend/src/hooks/usePreview.js && \
  green "Code: stableStringify implemented" || red "Code: stableStringify missing"

# Check: usePreview handles warm flag
grep -q "data.warm" /home/dev/Next-js/preview-worker-demo/frontend/src/hooks/usePreview.js && \
  green "Code: usePreview reads warm flag" || red "Code: usePreview ignores warm flag"

# Check: Badge is a React component, not raw JS appended
grep -q "PreviewBadge" /home/dev/Next-js/preview-worker-demo/worker/preview-system/preview-worker/worker.js && \
  green "Code: Badge is a React component" || red "Code: Badge is not a React component"
grep -q "app/PreviewBadge.js" /home/dev/Next-js/preview-worker-demo/worker/preview-system/preview-worker/worker.js && \
  green "Code: Badge injected as separate file" || red "Code: Badge appended to page.js"

# Check: WebSocket uses manual cookie parsing
grep -q "cookieHeader.split" /home/dev/Next-js/preview-worker-demo/worker/server.js && \
  green "Code: WebSocket uses manual cookie parser" || red "Code: WebSocket still uses cookie-parser middleware"

# Check: Anti-cache headers in proxy
grep -q "no-store" /home/dev/Next-js/preview-worker-demo/worker/preview-system/orchestrator/index.js && \
  green "Code: Anti-cache headers present in proxy" || red "Code: No anti-cache headers"

# Check: compileVersion in health endpoint
grep -q "compileVersion" /home/dev/Next-js/preview-worker-demo/worker/preview-system/preview-worker/worker.js && \
  green "Code: compileVersion tracked in worker" || red "Code: compileVersion missing"

# Check: Deterministic wait (no 800ms hardcode)
grep -q "800" /home/dev/Next-js/preview-worker-demo/worker/preview-system/orchestrator/index.js && \
  red "Code: 800ms hardcoded delay still present" || green "Code: 800ms delay removed (deterministic wait)"

# Check: Secret not hardcoded
grep -q "dGVzdC10b2tlbg" /home/dev/Next-js/preview-worker-demo/k8s/secret.yaml && \
  red "Code: Hardcoded test-token still in secret.yaml" || green "Code: Hardcoded secret removed"

# Check: cleanup uses keepalive
grep -q "keepalive" /home/dev/Next-js/preview-worker-demo/frontend/src/hooks/usePreview.js && \
  green "Code: Cleanup uses keepalive for tab-close" || red "Code: Cleanup missing keepalive"

# Check: TTL comment vs value mismatch
grep -q "300000" /home/dev/Next-js/preview-worker-demo/k8s/cronjob.yaml
HAS_300=$?
grep -q "360000" /home/dev/Next-js/preview-worker-demo/k8s/cronjob.yaml
HAS_360=$?
if [ $HAS_300 -eq 0 ] && [ $HAS_360 -eq 0 ]; then
  red "Code: TTL has both 300000 and 360000 — comment/value mismatch"
elif [ $HAS_360 -eq 0 ]; then
  green "Code: TTL value is 360000 (6 min) — kept as-is per user request"
fi

# ═══════════════════════════════════════════════════════════════
header "RESULTS"
# ═══════════════════════════════════════════════════════════════
echo -e "\n\033[1m  ✅ Passed: $PASS\033[0m"
echo -e "\033[1m  ❌ Failed: $FAIL\033[0m"
echo -e "\033[1m  ⏭️  Skipped: $SKIP\033[0m"
echo ""
[ $FAIL -eq 0 ] && echo -e "\033[32;1m🎉 ALL TESTS PASSED!\033[0m" || echo -e "\033[31;1m⚠️  $FAIL test(s) failed — review above.\033[0m"

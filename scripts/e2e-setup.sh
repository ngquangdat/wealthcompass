#!/usr/bin/env bash
# Thử toàn bộ quy trình tích hợp trên một web Angular "bên ngoài" (examples/hr-portal), giống dự án thật:
# đóng gói -> copy web sạch vào thư mục tạm (repo git riêng) -> setup -> git apply -> npm install -> build -> backend -> doctor.
# Dùng: npm run e2e:setup [-- --no-llm] [-- --keep]   (--keep: giữ thư mục và để backend chạy)
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${E2E_PORT:-8899}"
NO_LLM=""; KEEP=""
for a in "$@"; do
  case "$a" in
    --no-llm) NO_LLM="--no-llm" ;;
    --keep) KEEP=1 ;;
  esac
done

step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "Đóng gói"
(cd "$ROOT" && node scripts/pack.mjs > /dev/null)

WORK="$(mktemp -d)/hr-portal"
step "Copy web HR sạch vào $WORK"
cp -R "$ROOT/examples/hr-portal" "$WORK"
rm -rf "$WORK/node_modules" "$WORK/package-lock.json"
(cd "$WORK" && git init -q && git add -A && git -c user.email=e2e@local -c user.name=e2e commit -q -m "trước khi tích hợp")
(cd "$WORK" && npm install --no-audit --no-fund --silent)

step "wealthcompass setup"
(cd "$ROOT" && npx tsx packages/cli/src/main.ts setup --app "$WORK" --backend-url "http://localhost:$PORT" $NO_LLM)
test -z "$(cd "$WORK" && git status --porcelain -- src angular.json package.json)" || { echo "LỖI: setup đã sửa code của web"; exit 1; }

step "Áp patch và cài gói"
(cd "$WORK" && git apply --check wealthcompass-setup.patch && git apply wealthcompass-setup.patch)
(cd "$WORK" && npm install --no-audit --no-fund --silent)

step "Build web"
(cd "$WORK" && npx ng build --configuration development > build.log 2>&1) || { tail -30 "$WORK/build.log"; exit 1; }
echo "build OK"

step "Chạy backend (cổng $PORT) và doctor"
# Chạy thẳng file bin (không qua npx) để giữ đúng PID và chỉ tắt tiến trình do script này mở
cd "$WORK"
node node_modules/@wealthcompass/server/bin/wealthcompass-server.mjs --env-file wealthcompass.env > server.log 2>&1 &
SERVER_PID=$!
cd "$ROOT"
for i in $(seq 1 30); do curl -sf "http://localhost:$PORT/v1/health" > /dev/null && break; sleep 0.5; done
set +e
(cd "$WORK" && npx wealthcompass doctor --app .)
CODE=$?
set -e

if [ -z "$KEEP" ]; then
  kill "$SERVER_PID" 2>/dev/null || true
  rm -rf "$(dirname "$WORK")"
else
  echo "Giữ lại: $WORK (backend vẫn chạy ở cổng $PORT)"
fi
exit $CODE

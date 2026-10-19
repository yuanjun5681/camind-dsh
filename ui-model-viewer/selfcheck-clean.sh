#!/usr/bin/env bash
set -euo pipefail
# Verbose by default so the documented invocation reproduces the full validation log.
set -x

main_repo=$(git rev-parse --show-toplevel)
tmp=$(mktemp -d /tmp/camind-clean-check-XXXXXX)
repo="$tmp/repo"
cleanup() {
  if [ -d "$repo" ]; then git worktree remove --force "$repo"; fi
  rmdir "$tmp" 2>/dev/null || true
}
trap cleanup EXIT

: "${CAMIND_PLAYWRIGHT_PATH:?CAMIND_PLAYWRIGHT_PATH is required}"
: "${CAMIND_CHROMIUM_PATH:?CAMIND_CHROMIUM_PATH is required}"

git worktree add --detach "$repo" HEAD
ln -s "$main_repo/ui-shell/node_modules" "$repo/ui-shell/node_modules"
cd "$repo"
export DESKTOP_REPO="${DESKTOP_REPO:-$main_repo/../Camind-desktop}"
export CAM_AGENT_REPO="${CAM_AGENT_REPO:-$main_repo/../CAM-Agent}"
export CAMIND_PLAYWRIGHT_PATH
export CAMIND_CHROMIUM_PATH
# The Desktop source commit is pinned by the mirror manifest, never hardcoded here.
source_commit=$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('ui-model-viewer/mirror-manifest.json', 'utf8')).sourceCommit)")

node --version
node -e "console.log('esbuild', require('./ui-shell/node_modules/esbuild/package.json').version)"
node -e "console.log('playwright-core', require(process.env.CAMIND_PLAYWRIGHT_PATH + '/package.json').version)"
"$CAMIND_CHROMIUM_PATH" --version
git rev-parse HEAD
git -C "$DESKTOP_REPO" rev-parse HEAD
git -C "$DESKTOP_REPO" status --porcelain
# Only the two pinned fixtures below are hash-protected and diff-checked; adjacent repo
# working trees are recorded for the log, not isolated.
for f in packages/viewer/src/synthetic_pack.ts packages/viewer/test/gl_mock.ts; do
  git -C "$DESKTOP_REPO" show "$source_commit":"$f" | shasum -a 256
done
git -C "$DESKTOP_REPO" diff --exit-code --stat "$source_commit"..HEAD -- packages/viewer/src/synthetic_pack.ts packages/viewer/test/gl_mock.ts
git -C "$CAM_AGENT_REPO" rev-parse HEAD
git -C "$CAM_AGENT_REPO" status --porcelain
git status --short --branch
node ui-model-viewer/build.mjs
git diff --exit-code -- ui-model-viewer/lib/client.js ui-model-viewer/lib/host-core.js
test -z "$(git status --porcelain)"
node ui-model-viewer/selfcheck-mirror.mjs
CAMIND_MIRROR_LOCAL_ONLY=1 node ui-model-viewer/selfcheck-mirror.mjs
node ui-model-viewer/selfcheck-gp2.mjs
node ui-model-viewer/selfcheck-visibility.mjs
node ui-model-viewer/selfcheck-xray.mjs
node ui-model-viewer/selfcheck.mjs
node ui-preview/selfcheck.mjs
node ui-model-viewer/selfcheck-playback.mjs
node ui-model-viewer/selfcheck-layout.mjs
node ui-model-viewer/selfcheck-xray-gpu.mjs
node ui-model-viewer/selfcheck-xray-ui.mjs
git diff --check 726694d..HEAD
test -z "$(git status --porcelain)"
printf 'INT04_CLEAN_VALIDATION_EXIT=0\n'

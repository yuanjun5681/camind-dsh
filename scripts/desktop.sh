#!/bin/sh
# Camind 桌面端启动入口：官方 DeepSeek Harness 桌面应用（0.2.0 起上游提供），
# 以本项目的 DSH_HOME 启动——会话/设置/凭据/记忆库/机床档案/CAM run 与
# `node scripts/dsh.mjs web` 共用一份数据，desktop profile 加载全部 camind
# 插件与「CAM 加工」模式（init.mjs 的 desktop profile 模板生成）。
# macOS 的 open 命令不能传环境变量，故直接执行 App 内二进制。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export DSH_HOME="$ROOT/.dsh"

APP=""
# 优先 Camind.app（官方 App 的品牌化副本：Camind 图标 + ad-hoc 重签；
# 由官方桌面自动更新覆盖后需按 README 步骤重做）。
for candidate in "/Applications/Camind.app" "$HOME/Applications/Camind.app" \
                 "/Applications/DeepSeek Harness.app" "$HOME/Applications/DeepSeek Harness.app"; do
  if [ -d "$candidate" ]; then
    APP="$candidate"
    break
  fi
done
if [ -z "$APP" ]; then
  echo "未找到 Camind.app 或 DeepSeek Harness 桌面应用。请先安装：" >&2
  echo "  curl -LO https://download.deepseek.com/desktop/dsh-latest-macos-arm64.dmg" >&2
  exit 1
fi

exec "$APP/Contents/MacOS/DeepSeek Harness" "$@"

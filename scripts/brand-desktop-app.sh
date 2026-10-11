#!/bin/sh
# 构建 Camind.app：官方 DeepSeek Harness 桌面应用的品牌化副本（Camind 图标 + 名称）。
# 官方包是已签名/公证的 App bundle，macOS 对其施加 MACL 写保护（且改动必然破坏签名），
# 因此正路是「拷贝成新 bundle + ad-hoc 重签」（首次打开无需任何确认，quarantine 已清）。
# 官方桌面自动更新会整体替换官方 App；更新后重跑本脚本重建（DMG 重装同理）。
# 图标规范：macOS 用 .icns（16~1024 全尺寸，圆角蒙版由系统施加，源图满幅方形即可）；
# Windows 侧规范见 README 桌面一节（.ico 需 16/24/32/48/64/128/256 多尺寸，本脚本不产出）。
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/ui-brand/assets/camind-mascot.png"
OFFICIAL="${1:-/Applications/DeepSeek Harness.app}"
TARGET="${2:-/Applications/Camind.app}"

[ -f "$SRC" ] || { echo "缺源图：$SRC" >&2; exit 1; }
[ -d "$OFFICIAL" ] || { echo "未找到官方桌面应用：$OFFICIAL" >&2; exit 1; }

echo "==> 复制 $OFFICIAL -> $TARGET"
rm -rf "$TARGET"
cp -R "$OFFICIAL" "$TARGET"
# 拷贝会带上 quarantine/provenance；清掉以免首启警告（副本未经过 MACL 保护路径）。
xattr -rd com.apple.quarantine "$TARGET" 2>/dev/null || true

echo "==> 生成 .icns（macOS 全尺寸组）"
WORK="$(mktemp -d)/camind.iconset"
mkdir -p "$WORK"
for spec in "16 16x16" "32 16x16@2x" "32 32x32" "64 32x32@2x" \
            "128 128x128" "256 128x128@2x" "256 256x256" "512 256x256@2x" \
            "512 512x512" "1024 512x512@2x"; do
  size=${spec%% *}; name=${spec##* }
  sips -z "$size" "$size" "$SRC" --out "$WORK/icon_${name}.png" > /dev/null
done
iconutil -c icns "$WORK" -o /tmp/camind-brand.icns

echo "==> 替换图标与名称"
cp /tmp/camind-brand.icns "$TARGET/Contents/Resources/icon.icns"
sips -z 512 512 "$SRC" --out "$TARGET/Contents/Resources/icon.png" > /dev/null
/usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName Camind" "$TARGET/Contents/Info.plist"
# CFBundleName 不能改：Electron 按它定位 * Helper.app，改名即 FATAL。
# CFBundleIdentifier 也不能改：helper 解析按同一前缀。

echo "==> ad-hoc 重签"
codesign --force --deep --sign - "$TARGET"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$TARGET"

echo "完成：${TARGET}（Dock/聚焦/Finder 均显示 Camind 图标；scripts/desktop.sh 会优先启动它）"

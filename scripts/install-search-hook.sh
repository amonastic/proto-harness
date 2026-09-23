#!/usr/bin/env bash
# 安装 pre-push hook，推送前自动构建搜索索引
# 运行：bash scripts/install-search-hook.sh
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.git/hooks/pre-push"
SRC="$ROOT/scripts/search-pre-push.sh"

if [ ! -d "$ROOT/.git/hooks" ]; then
    echo "错误：未找到 .git/hooks 目录"
    exit 1
fi

cp "$SRC" "$HOOK"
chmod +x "$HOOK"
echo "已安装 pre-push hook：$HOOK"
echo "之后每次 git push 会自动运行 node scripts/build-search-index.js"
echo "若索引有变化，会自动创建提交"

#!/usr/bin/env bash
# pre-push hook：推送前自动构建全局搜索索引
# 若索引文件有变化，自动创建一个新提交包含索引更新
# 安装：bash scripts/install-search-hook.sh

set -e

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

echo "[search-index] 构建全局搜索索引..."
node scripts/build-search-index.js

# 检查索引文件是否有变化
if ! git diff --quiet -- assets/js/search-index.js; then
    echo "[search-index] 索引有更新，提交..."
    git add assets/js/search-index.js
    git commit -m "chore(search): 自动更新全局搜索索引" --no-verify
    echo "[search-index] 已提交索引更新"
else
    echo "[search-index] 索引无变化"
fi

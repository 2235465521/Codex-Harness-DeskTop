#!/usr/bin/env bash
# agate verify 优先调度本脚本，避免全盘误扫 node_modules/release
set -euo pipefail
npm test

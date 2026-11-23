#!/usr/bin/env bash
set -eo pipefail

firmware_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export IDF_PATH="$firmware_dir/.tools/esp-idf"
export IDF_TOOLS_PATH="$firmware_dir/.tools/espressif"
export PIP_CACHE_DIR="$firmware_dir/.tools/pip-cache"

if [[ ! -f "$IDF_PATH/export.sh" || ! -f "$firmware_dir/.tools/python-env-path" ]]; then
    printf 'Run %s/scripts/setup.sh first.\n' "$firmware_dir" >&2
    exit 1
fi
export IDF_PYTHON_ENV_PATH="$(cat "$firmware_dir/.tools/python-env-path")"
export PATH="$IDF_PYTHON_ENV_PATH/bin:$PATH"
# export.sh detects and activates the Python environment installed by setup.sh.
# It is an upstream shell script and must be sourced without nounset.
source "$IDF_PATH/export.sh" >&2
cd "$firmware_dir"
if [[ "${1:-}" == ota && $# == 1 ]]; then
    idf.py build
    exec python scripts/ota.py serve
fi
idf.py "$@"

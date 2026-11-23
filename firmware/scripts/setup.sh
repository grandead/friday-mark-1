#!/usr/bin/env bash
set -euo pipefail

firmware_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
idf_version="v5.5.2"
export IDF_PATH="$firmware_dir/.tools/esp-idf"
export IDF_TOOLS_PATH="$firmware_dir/.tools/espressif"
export PIP_CACHE_DIR="$firmware_dir/.tools/pip-cache"
unset IDF_PYTHON_ENV_PATH

if [[ -n "${IDF_BOOTSTRAP_PYTHON:-}" ]]; then
    bootstrap_python="$IDF_BOOTSTRAP_PYTHON"
elif [[ "$(uname -s)" == Darwin && -x /usr/bin/python3 ]]; then
    bootstrap_python=/usr/bin/python3
else
    bootstrap_python=python3
fi

command -v git >/dev/null
"$bootstrap_python" -c 'import sys; assert (3, 9) <= sys.version_info < (3, 14), "Use Python 3.9–3.13 via IDF_BOOTSTRAP_PYTHON"'
mkdir -p "$firmware_dir/.tools"

if [[ ! -d "$IDF_PATH" ]]; then
    git clone --branch "$idf_version" --depth 1 --shallow-submodules --recursive \
        https://github.com/espressif/esp-idf.git "$IDF_PATH"
fi
if [[ "$(git -C "$IDF_PATH" describe --tags --exact-match HEAD)" != "$idf_version" ]]; then
    printf 'Expected ESP-IDF %s at %s; refusing to modify this checkout.\n' "$idf_version" "$IDF_PATH" >&2
    exit 1
fi
git -C "$IDF_PATH" submodule update --init --recursive --depth 1
"$bootstrap_python" "$IDF_PATH/tools/idf_tools.py" --non-interactive install --targets=esp32
"$bootstrap_python" "$IDF_PATH/tools/idf_tools.py" --non-interactive install cmake ninja
"$bootstrap_python" "$IDF_PATH/tools/idf_tools.py" --non-interactive install-python-env --features=core
"$bootstrap_python" - <<'PY' > "$firmware_dir/.tools/python-env-path"
import os
import sys
sys.path.insert(0, os.path.join(os.environ["IDF_PATH"], "tools"))
import idf_tools
idf_tools.g.idf_path = os.environ["IDF_PATH"]
idf_tools.g.idf_tools_path = os.environ["IDF_TOOLS_PATH"]
print(idf_tools.get_python_env_path()[0])
PY
printf '\nReady. Build with: %s/scripts/idf.sh build\n' "$firmware_dir"

#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'This local installer targets macOS. On Linux, install Ollama from https://ollama.com/download/linux and set OLLAMA_BIN.' >&2
  exit 1
fi
version=v0.40.17
checksum=4b9db20d077c5a1e52fb4a6f2e6791f76ae945fd07c9b1a5647c82e927826653
mkdir -p .tools/ollama models/ollama
if [[ -x .tools/ollama/ollama && -f .tools/ollama/VERSION && "$(cat .tools/ollama/VERSION)" == "$version" ]]; then
  echo "Ollama $version is already installed."
  exit 0
fi
archive=.tools/ollama-darwin.tgz
if [[ ! -f "$archive" ]]; then
  curl --fail --location --retry 3 --output "$archive" \
    "https://github.com/ollama/ollama/releases/download/$version/ollama-darwin.tgz"
fi
printf '%s  %s\n' "$checksum" "$archive" | shasum -a 256 -c -
tar -xzf "$archive" -C .tools/ollama
printf '%s\n' "$version" > .tools/ollama/VERSION
rm "$archive"
echo 'Ollama installed. Run npm run llm:serve, then npm run llm:pull in another terminal.'

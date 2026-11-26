#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SERVER_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
cd "$SERVER_ROOT"
BINARY="${WHISPER_SERVER_BIN:-$SERVER_ROOT/.tools/whisper.cpp/build/bin/whisper-server}"
MODEL="${WHISPER_MODEL:-$SERVER_ROOT/models/whisper/ggml-small.bin}"
VAD_MODEL="${WHISPER_VAD_MODEL:-$SERVER_ROOT/models/whisper/ggml-silero-v5.1.2.bin}"

if [[ ! -x "$BINARY" || ! -r "$MODEL" || ! -r "$VAD_MODEL" ]]; then
  echo 'Whisper server or models are missing. Run npm run setup:whisper.' >&2
  exit 1
fi

exec "$BINARY" --host 127.0.0.1 --port "${WHISPER_PORT:-33001}" \
  -m "$MODEL" -l "${WHISPER_LANGUAGE:-ru}" --no-context \
  -bo 5 -bs 5 -nt --vad -vm "$VAD_MODEL" -vp 150 "$@"

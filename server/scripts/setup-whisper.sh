#!/usr/bin/env bash
set -euo pipefail

# whisper.cpp v1.8.2 and immutable model revisions.
WHISPER_REVISION=4979e04f5dcaccb36057e059bbaed8a2f5288315
SMALL_REVISION=5359861c739e955e79d9a303bcbc70fb988958b1
VAD_REVISION=9ffd54a1e1ee413ddf265af9913beaf518d1639b
SMALL_SHA256=1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b
VAD_SHA256=29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
SERVER_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
SOURCE_DIR="$SERVER_ROOT/.tools/whisper.cpp"
MODEL_DIR="$SERVER_ROOT/models/whisper"

fail() {
  echo "$*" >&2
  exit 1
}

verify_model() {
  local path="$1" checksum="$2"
  [[ -f "$path" ]] || return 1
  printf '%s  %s\n' "$checksum" "$path" | shasum -a 256 -c - >/dev/null 2>&1
}

install_model() {
  local name="$1" checksum="$2" url="$3"
  local target="$MODEL_DIR/$name" previous="$SERVER_ROOT/models/$name"
  if [[ -f "$target" ]]; then
    verify_model "$target" "$checksum" || fail "Checksum mismatch: $target. Move it aside and rerun setup."
    echo "Verified $name"
    return
  fi
  if [[ -f "$previous" ]]; then
    verify_model "$previous" "$checksum" || fail "Checksum mismatch: $previous. Move it aside and rerun setup."
    mv "$previous" "$target"
    echo "Moved verified $name into models/whisper"
    return
  fi
  curl --fail --location --retry 5 --connect-timeout 20 --output "$target.part" "$url"
  verify_model "$target.part" "$checksum" || fail "Checksum mismatch: $target.part. Rerun setup to download again."
  mv "$target.part" "$target"
}

for command in git cmake curl shasum c++; do
  command -v "$command" >/dev/null || fail "Missing $command. On macOS install Xcode Command Line Tools (xcode-select --install) and CMake (brew install cmake)."
done
mkdir -p "$SERVER_ROOT/.tools" "$MODEL_DIR"
if [[ ! -d "$SOURCE_DIR" ]]; then
  git clone --depth 1 --branch v1.8.2 https://github.com/ggml-org/whisper.cpp.git "$SOURCE_DIR"
fi
installed_revision=$(git -C "$SOURCE_DIR" rev-parse HEAD)
[[ "$installed_revision" == "$WHISPER_REVISION" ]] || fail "Unexpected whisper.cpp revision: $installed_revision. Expected $WHISPER_REVISION; move $SOURCE_DIR aside and rerun setup."
changes=$(git -C "$SOURCE_DIR" status --porcelain --untracked-files=no)
[[ -z "$changes" ]] || fail "whisper.cpp has local source changes. Preserve them outside $SOURCE_DIR before running setup."

install_model ggml-small.bin "$SMALL_SHA256" \
  "https://huggingface.co/ggerganov/whisper.cpp/resolve/$SMALL_REVISION/ggml-small.bin"
install_model ggml-silero-v5.1.2.bin "$VAD_SHA256" \
  "https://huggingface.co/ggml-org/whisper-vad/resolve/$VAD_REVISION/ggml-silero-v5.1.2.bin"

cmake -S "$SOURCE_DIR" -B "$SOURCE_DIR/build" \
  -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=ON
cmake --build "$SOURCE_DIR/build" --config Release -j 4 --target whisper-server
printf '\nWhisper Small and Silero VAD are ready. Run npm run stt:serve.\n'

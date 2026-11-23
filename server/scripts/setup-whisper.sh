#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p .tools models
version=v1.8.2
if [[ ! -d .tools/whisper.cpp/.git ]]; then
  git clone --depth 1 --branch "$version" https://github.com/ggml-org/whisper.cpp.git .tools/whisper.cpp
fi
cmake -S .tools/whisper.cpp -B .tools/whisper.cpp/build -DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF
cmake --build .tools/whisper.cpp/build --config Release -j 4 --target whisper-cli
# Multilingual small: Russian + English; download once, then work offline.
if [[ ! -f models/ggml-small.bin ]]; then
  curl --fail --location --retry 3 --output models/ggml-small.bin.part \
    https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin
  mv models/ggml-small.bin.part models/ggml-small.bin
fi
# Silero VAD prevents empty/noisy recordings from being decoded as speech.
if [[ ! -f models/ggml-silero-v5.1.2.bin ]]; then
  curl --fail --location --retry 3 --output models/ggml-silero-v5.1.2.bin.part \
    https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin
  mv models/ggml-silero-v5.1.2.bin.part models/ggml-silero-v5.1.2.bin
fi
printf '\nWhisper ready. Start with ASR_ENGINE=whisper npm start, or ASR_ENGINE=hybrid npm start if Vosk is installed.\n'

#!/usr/bin/env bash
set -euo pipefail
firmware_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
test_dir="$(mktemp -d "${TMPDIR:-/tmp}/friday-tests.XXXXXX")"
trap 'rm -rf "$test_dir"' EXIT
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
    -DFRIDAY_FIR_PAIR_TEST=1 -I "$firmware_dir/main" "$firmware_dir/main/audio_level.c" \
    "$firmware_dir/main/audio_pcm.c" \
    "$firmware_dir/main/level_scene.c" "$firmware_dir/tests/test_audio_level.c" \
    -lm -o "$test_dir/test_audio_level"
"$test_dir/test_audio_level"
"${CC:-cc}" -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined \
    -I "$firmware_dir/main" "$firmware_dir/main/touch_gate.c" \
    "$firmware_dir/tests/test_touch_gate.c" -lm -o "$test_dir/test_touch_gate"
"$test_dir/test_touch_gate"

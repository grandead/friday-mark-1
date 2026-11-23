#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
typedef struct { float previous_input; float previous_output; bool initialized; } audio_pcm_filter_t;
void audio_pcm_convert(audio_pcm_filter_t *filter, const uint16_t *samples, int16_t *pcm, size_t count);

enum { PCM_RATE = 16000, RESAMPLE_TAPS = 48 };
typedef struct {
    int16_t history[2 * RESAMPLE_TAPS];
    unsigned head, phase;
} pcm_resampler_t;
// Convert 20 kHz to 16 kHz in place, retaining FIR history between DMA blocks.
size_t pcm_resample(pcm_resampler_t *state, int16_t *pcm, size_t count);

#if FRIDAY_FIR_PAIR_TEST
enum { FIR_TEST_FRAME = 512 };
typedef struct {
    int16_t first[FIR_TEST_FRAME], second[FIR_TEST_FRAME];
    size_t first_count, second_count;
    bool awaiting_second;
} pcm_pair_t;
// Emits the previous frame on each call. The control uses the same copies and latency.
size_t pcm_resample_pair(pcm_pair_t *pair, pcm_resampler_t *state, int16_t *pcm, size_t count);
#endif

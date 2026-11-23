#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

typedef struct {
    float dc;
    float rms;
    bool clipped;
    bool bias_ok;
    bool calibrating;
    float noise_rms;
} audio_level_t;

enum {
    AUDIO_SAMPLE_RATE = 20000,
    AUDIO_CAL_WARMUP_SAMPLES = AUDIO_SAMPLE_RATE / 2,
    AUDIO_CAL_MEASURE_SAMPLES = AUDIO_SAMPLE_RATE * 5 / 2,
    AUDIO_CAL_BINS = 128,
};

typedef struct {
    unsigned warmup_left;
    unsigned measured_samples;
    unsigned histogram[AUDIO_CAL_BINS];
    float noise_rms;
    float threshold_rms;
    bool ready;
} audio_calibration_t;

// Remove the frame's DC bias, then measure AC RMS in raw 12-bit ADC counts.
audio_level_t audio_level_measure(const uint16_t *samples, size_t count);

void audio_calibration_reset(audio_calibration_t *calibration);
// First 0.5 s settles the input; the following 2.5 s measures the background.
// The calibrated noise floor is used for voice endpoint detection.
void audio_calibration_apply(audio_calibration_t *calibration, audio_level_t *level,
                             unsigned sample_count);

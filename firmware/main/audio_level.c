#include "audio_level.h"

#include <math.h>
#include <string.h>

audio_level_t audio_level_measure(const uint16_t *samples, size_t count)
{
    audio_level_t result = {0};
    if (samples == NULL || count == 0) {
        return result;
    }

    double sum = 0;
    double sum_squared = 0;
    for (size_t i = 0; i < count; ++i) {
        const double sample = samples[i];
        sum += sample;
        sum_squared += sample * sample;
        result.clipped |= samples[i] <= 5 || samples[i] >= 4090;
    }
    const double mean = sum / count;
    const double variance = fmax(0, sum_squared / count - mean * mean);
    result.dc = (float)mean;
    result.rms = (float)sqrt(variance);
    result.bias_ok = mean >= 100 && mean <= 3900;

    return result;
}

void audio_calibration_reset(audio_calibration_t *calibration)
{
    memset(calibration, 0, sizeof(*calibration));
    calibration->warmup_left = AUDIO_CAL_WARMUP_SAMPLES;
}

void audio_calibration_apply(audio_calibration_t *calibration, audio_level_t *level,
                             unsigned sample_count)
{
    if (!calibration->ready) {
        level->calibrating = true;
        // A disconnected/railed input must not become the background reference.
        if (!level->bias_ok || level->clipped) {
            audio_calibration_reset(calibration);
            return;
        }
        const unsigned settling = sample_count < calibration->warmup_left
                                      ? sample_count : calibration->warmup_left;
        calibration->warmup_left -= settling;
        sample_count -= settling;
        const unsigned remaining = AUDIO_CAL_MEASURE_SAMPLES - calibration->measured_samples;
        if (sample_count > remaining) sample_count = remaining;

        // A sample-weighted histogram approximates the 90th percentile RMS.
        // A brief click during setup does not define the entire noise floor.
        int bin = (int)(fmaxf(0, level->rms) / 16.0f);
        if (bin >= AUDIO_CAL_BINS) bin = AUDIO_CAL_BINS - 1;
        calibration->histogram[bin] += sample_count;
        calibration->measured_samples += sample_count;
        if (calibration->measured_samples < AUDIO_CAL_MEASURE_SAMPLES) return;

        unsigned cumulative = 0;
        for (int i = 0; i < AUDIO_CAL_BINS; ++i) {
            cumulative += calibration->histogram[i];
            if (cumulative >= (AUDIO_CAL_MEASURE_SAMPLES * 9) / 10) {
                calibration->noise_rms = (i + 1) * 16.0f;
                break;
            }
        }
        // Margin suppresses normal fluctuations. A very loud calibration has
        // insufficient headroom: wait for a quieter interval and try again.
        calibration->threshold_rms = calibration->noise_rms * 1.25f;
        if (calibration->threshold_rms >= 1800.0f) {
            audio_calibration_reset(calibration);
            return;
        }
        calibration->ready = true;
    }

    level->calibrating = false;
    level->noise_rms = calibration->noise_rms;
}

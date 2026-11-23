#include <assert.h>
#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#include "audio_level.h"
#include "audio_pcm.h"
#include "level_scene.h"
#include "voice_capture.h"

static audio_level_t tone(int bias, int amplitude)
{
    uint16_t samples[400];
    for (int i = 0; i < 400; ++i) {
        samples[i] = (uint16_t)lround(bias + amplitude * sin(2.0 * 3.141592653589793 * i / 40));
    }
    return audio_level_measure(samples, 400);
}

static void test_resampler(unsigned frequency)
{
    int16_t input[2000], batch[2000], chunk[37];
    pcm_resampler_t whole = {0}, split = {0};
    for (unsigned i = 0; i < 2000; ++i) {
        batch[i] = input[i] = lround(10000 * sin(2 * 3.141592653589793 * frequency * i / 20000));
    }
    size_t count = pcm_resample(&whole, batch, 2000);
    assert(count == 1600);
    size_t out = 0;
    double power = 0;
    for (unsigned i = 0; i < 2000; i += 37) {
        unsigned n = 2000 - i < 37 ? 2000 - i : 37;
        for (unsigned j = 0; j < n; ++j) chunk[j] = input[i + j];
        size_t written = pcm_resample(&split, chunk, n);
        for (size_t j = 0; j < written; ++j, ++out) {
            assert(out < count && chunk[j] == batch[out]);
            if (out >= 64) power += (double)chunk[j] * chunk[j];
        }
    }
    assert(out == count);
    double rms = sqrt(power / (count - 64));
    if (frequency == 1000) assert(rms > 7050 && rms < 7090);
    else assert(rms < 12);
}

int main(void)
{
    // Pair scheduling must return the previous reference frame byte for byte.
    pcm_pair_t pair = {0};
    pcm_resampler_t paired = {0}, reference = {0};
    int16_t previous[FIR_TEST_FRAME], current[FIR_TEST_FRAME], delayed[FIR_TEST_FRAME];
    size_t previous_count = 0;
    for (unsigned frame = 0; frame < 50; ++frame) {
        size_t n = frame % 3 == 0 ? 17 : FIR_TEST_FRAME;
        for (size_t i = 0; i < n; ++i) current[i] = (int16_t)(i * 997 + frame * 479);
        memcpy(delayed, current, n * sizeof(*current));
        size_t emitted = pcm_resample_pair(&pair, &paired, delayed, n);
        assert(emitted == previous_count && memcmp(delayed, previous, emitted * sizeof(*delayed)) == 0);
        previous_count = pcm_resample(&reference, current, n);
        memcpy(previous, current, previous_count * sizeof(*previous));
    }
    test_resampler(1000);
    test_resampler(9000);
    // The DC filter must produce identical PCM across arbitrary DMA boundaries.
    uint16_t raw[2000];
    int16_t whole[2000], split[2000];
    for (int i = 0; i < 2000; ++i) raw[i] = (uint16_t)(1700 + 700 * sin(i * 0.3));
    audio_pcm_filter_t a = {0}, b = {0};
    audio_pcm_convert(&a, raw, whole, 2000);
    audio_pcm_convert(&b, raw, split, 512);
    audio_pcm_convert(&b, raw + 512, split + 512, 1488);
    for (int i = 0; i < 2000; ++i) assert(whole[i] == split[i]);
    audio_pcm_filter_t dc_filter = {0};
    for (int i = 0; i < 2000; ++i) raw[i] = 1700;
    audio_pcm_convert(&dc_filter, raw, whole, 2000);
    for (int i = 0; i < 2000; ++i) assert(whole[i] == 0);
    const audio_level_t silence = tone(1700, 0);
    assert(silence.rms == 0 && silence.bias_ok && !silence.clipped);

    const audio_level_t signal = tone(1700, 500);
    assert(fabsf(signal.rms - 500 / sqrtf(2)) < 1);
    assert(fabsf(signal.dc - 1700) < 1);
    assert(!signal.clipped && signal.bias_ok);

    const audio_level_t shifted = tone(2300, 500);
    assert(fabsf(signal.rms - shifted.rms) < 0.01f);

    const uint16_t clipped[] = {0, 4095, 0, 4095};
    const audio_level_t overload = audio_level_measure(clipped, 4);
    assert(overload.clipped);
    assert(!tone(0, 0).bias_ok);
    assert(audio_level_measure(NULL, 0).rms == 0);

    audio_calibration_t calibration;
    audio_calibration_reset(&calibration);
    audio_level_t background = {.rms = 100, .bias_ok = true};
    audio_calibration_apply(&calibration, &background, AUDIO_CAL_WARMUP_SAMPLES);
    assert(!calibration.ready && calibration.measured_samples == 0 && background.calibrating);
    // A brief loud event occupying 5% of the interval should not raise the floor.
    audio_level_t click = {.rms = 1000, .bias_ok = true};
    audio_calibration_apply(&calibration, &click, AUDIO_CAL_MEASURE_SAMPLES / 20);
    audio_calibration_apply(&calibration, &background, AUDIO_CAL_MEASURE_SAMPLES * 19 / 20);
    assert(calibration.ready && !background.calibrating);
    assert(calibration.noise_rms >= 100 && calibration.noise_rms <= 116);
    // A missing input cannot calibrate; reset also discards an old reference.
    audio_calibration_reset(&calibration);
    audio_level_t bad_input = {.rms = 10, .bias_ok = false};
    audio_calibration_apply(&calibration, &bad_input, AUDIO_SAMPLE_RATE * 4);
    assert(!calibration.ready && calibration.measured_samples == 0);
    audio_level_t quiet = {.rms = 0, .bias_ok = true};
    audio_calibration_apply(&calibration, &quiet, AUDIO_SAMPLE_RATE * 3);
    assert(calibration.ready && quiet.noise_rms > 0);
    audio_calibration_reset(&calibration);
    audio_level_t too_loud = {.rms = 1700, .bias_ok = true};
    audio_calibration_apply(&calibration, &too_loud, AUDIO_SAMPLE_RATE * 3);
    assert(!calibration.ready && too_loud.calibrating);

    voice_silence_t gate = {0};
    assert(!voice_silence_elapsed(&gate, false, AUDIO_SAMPLE_RATE));
    assert(!voice_silence_elapsed(&gate, true, 512));
    assert(!voice_silence_elapsed(&gate, true, 512));
    assert(!voice_silence_elapsed(&gate, false, VOICE_QUIET_SAMPLES - 1));
    assert(voice_silence_elapsed(&gate, false, 1));

    level_scene_t scene = {.status = ""};
    for (int y = 0; y < 240; ++y)
        for (int x = 0; x < 240; ++x) assert(level_scene_pixel(&scene, x, y) == 0);
    const char *states[] = {"LISTENING", "QUIET PLEASE", "RECORD ERROR"};
    for (int i = 0; i < 3; ++i) {
        scene.status = states[i];
        int lit = 0;
        for (int y = 0; y < 240; ++y)
            for (int x = 0; x < 240; ++x)
                if (level_scene_pixel(&scene, x, y)) {
                    assert(i == 0 ? y >= 106 && y < 134 : y >= 182 && y < 196);
                    ++lit;
                }
        assert(lit > 0);
    }
    puts("PASS: PCM, RMS, calibration, 1.5-second endpoint and status display");
}

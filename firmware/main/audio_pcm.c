#include "audio_pcm.h"
#include <math.h>
#include <string.h>

void audio_pcm_convert(audio_pcm_filter_t *filter, const uint16_t *samples, int16_t *pcm, size_t count)
{
    // Continuous 80 Hz high-pass at 20 kHz. Do not reset at DMA/frame boundaries:
    // subtracting each frame's mean would create clicks in the recorded audio.
    for (size_t i = 0; i < count; ++i) {
        const float input = samples[i];
        if (!filter->initialized) {
            filter->previous_input = input;
            filter->initialized = true;
        }
        const float output = input - filter->previous_input + 0.97518046f * filter->previous_output;
        filter->previous_input = input;
        filter->previous_output = output;
        pcm[i] = (int16_t)lroundf(fminf(32767, fmaxf(-32768, output * 16.0f)));
    }
}

// Blackman-windowed sinc at 7.3 kHz, Q15, unity DC gain for each quarter-sample delay.
static const int16_t kernels[4][RESAMPLE_TAPS] = {
    {
        0, 1, -3, 1, 10, -26, 27, 9, -77, 126, -79, -93,
        306, -369, 112, 426, -909, 841, 71, -1557, 2682, -2082, -2011, 18978,
        18978, -2011, -2082, 2682, -1557, 71, 841, -909, 426, 112, -369, 306,
        -93, -79, 126, -77, 9, 27, -26, 10, 1, -3, 1, 0,
    },
    {
        0, 1, -1, -3, 14, -21, 5, 41, -91, 85, 21, -196,
        308, -191, -194, 648, -777, 255, 843, -1882, 1867, 85, -4490, 13734,
        22599, 2229, -3993, 2702, -669, -798, 1195, -750, 52, 397, -435, 205,
        45, -157, 126, -38, -27, 40, -22, 3, 5, -3, 1, 0,
    },
    {
        0, 0, 1, -7, 14, -10, -17, 59, -75, 20, 111, -234,
        213, 38, -425, 656, -412, -369, 1294, -1603, 594, 1870, -5099, 7824,
        23918, 7710, -4951, 1789, 559, -1488, 1181, -331, -364, 569, -361, 32,
        174, -187, 86, 15, -55, 41, -11, -6, 8, -3, 0, 0,
    },
    {
        0, 0, 2, -8, 9, 4, -34, 58, -37, -50, 163, -197,
        55, 246, -512, 460, 59, -838, 1313, -863, -713, 2834, -4127, 2270,
        22681, 13583, -4376, 82, 1766, -1752, 773, 230, -688, 564, -166, -160,
        252, -157, 16, 65, -66, 29, 4, -13, 8, -1, 0, 0,
    }
};

size_t pcm_resample(pcm_resampler_t *state, int16_t *pcm, size_t count)
{
    size_t written = 0;
    for (size_t i = 0; i < count; ++i) {
        state->head = state->head ? state->head - 1 : RESAMPLE_TAPS - 1;
        state->history[state->head] = state->history[state->head + RESAMPLE_TAPS] = pcm[i];
        state->phase += 4;
        if (state->phase < 5) continue;
        state->phase -= 5;
        const int16_t *history = state->history + state->head;
        const int16_t *kernel = kernels[state->phase];
        int64_t sum = 0;
        for (unsigned k = 0; k < RESAMPLE_TAPS; ++k) sum += (int32_t)history[k] * kernel[k];
        int32_t value = (sum + 16384) >> 15;
        pcm[written++] = value > INT16_MAX ? INT16_MAX : value < INT16_MIN ? INT16_MIN : value;
    }
    return written;
}

#if FRIDAY_FIR_PAIR_TEST
size_t pcm_resample_pair(pcm_pair_t *pair, pcm_resampler_t *state, int16_t *pcm, size_t count)
{
    if (!pair->awaiting_second) {
        memcpy(pair->first, pcm, count * sizeof(*pcm));
#if FRIDAY_FIR_PAIR_CONTROL
        pair->first_count = pcm_resample(state, pair->first, count);
#else
        pair->first_count = count;
#endif
        memcpy(pcm, pair->second, pair->second_count * sizeof(*pcm));
        pair->awaiting_second = true;
        return pair->second_count;
    }
    memcpy(pair->second, pcm, count * sizeof(*pcm));
#if FRIDAY_FIR_PAIR_CONTROL
    const size_t written = pair->first_count;
#else
    const size_t written = pcm_resample(state, pair->first, pair->first_count);
#endif
    pair->second_count = pcm_resample(state, pair->second, count);
    memcpy(pcm, pair->first, written * sizeof(*pcm));
    pair->awaiting_second = false;
    return written;
}
#endif

#include "wakeword.h"
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "wakeword_model.inc"

enum { BANDS = 32, FEATURES = 13 };
static const float threshold = 0.190629252116168f;
typedef struct { float re, im; } complex_pair_t;

struct wakeword {
    int16_t pcm[WAKEWORD_WINDOW];
    unsigned filled, cooldown, column;
    float window[WAKEWORD_WINDOW];
    complex_pair_t fft[WAKEWORD_WINDOW];
    float dp[2][TEMPLATE_FRAMES + TEMPLATE_COUNT];
    float previous_cost[TEMPLATE_FRAMES + TEMPLATE_COUNT];
};

void wakeword_reset(wakeword_t *s)
{
    s->filled = s->cooldown = s->column = 0;
    // Column zero permits starting at any input offset. The column before it
    // is unreachable, including by the two-input-frame DTW step.
    for (unsigned i = 0; i < TEMPLATE_FRAMES + TEMPLATE_COUNT; ++i) {
        s->dp[0][i] = s->dp[1][i] = s->previous_cost[i] = INFINITY;
    }
    unsigned offset = 0;
    for (unsigned t = 0; t < TEMPLATE_COUNT; ++t) {
        s->dp[0][offset] = 0;
        offset += template_lengths[t] + 1;
    }
}

wakeword_t *wakeword_create(void)
{
    wakeword_t *s = malloc(sizeof(*s));
    if (s) wakeword_reset(s);
    return s;
}

// Mixed-radix FFT, 500 = 4 * 5 * 5 * 5. Keeping the original window length
// preserves the 40 Hz bin grid used to train and test the templates on Mac.
static void fft(complex_pair_t *out, const float *in, int n, int stride)
{
    const int radix = n == WAKEWORD_WINDOW ? 4 : 5;
    const int width = n / radix;
    if (width == 1) {
        for (int j = 0; j < radix; ++j) out[j] = (complex_pair_t){in[j * stride], 0};
    } else {
        for (int j = 0; j < radix; ++j)
            fft(out + j * width, in + j * stride, width, stride * radix);
    }
    for (int k = 0; k < width; ++k) {
        complex_pair_t inputs[5];
        for (int j = 0; j < radix; ++j) inputs[j] = out[k + j * width];
        for (int bin = k; bin < n; bin += width) {
            complex_pair_t sum = inputs[0];
            const int step = bin * stride;
            int phase = step;
            for (int j = 1; j < radix; ++j) {
                const float c = fft_cos[phase], s = fft_sin[phase];
                sum.re += inputs[j].re * c - inputs[j].im * s;
                sum.im += inputs[j].im * c + inputs[j].re * s;
                phase += step;
                if (phase >= WAKEWORD_WINDOW) phase -= WAKEWORD_WINDOW;
            }
            out[bin] = sum;
        }
    }
}

static void features(wakeword_t *s, float vector[FEATURES])
{
    int32_t sum = 0;
    for (unsigned i = 0; i < WAKEWORD_WINDOW; ++i) sum += s->pcm[i];
    const float mean = sum * (1.0f / WAKEWORD_WINDOW);
    for (unsigned i = 0; i < WAKEWORD_WINDOW; ++i)
        s->window[i] = (s->pcm[i] - mean) * hann[i];
    fft(s->fft, s->window, WAKEWORD_WINDOW, 1);
    float bands[BANDS];
    const float *weight = mel_weights;
    for (unsigned b = 0; b < BANDS; ++b) {
        float power = 0;
        for (int j = 0; j < mel_count[b]; ++j) {
            const complex_pair_t z = s->fft[mel_start[b] + j];
            power += (z.re*z.re + z.im*z.im) * *weight++;
        }
        bands[b] = logf(power > 1 ? power : 1);
    }
    float norm = 0;
    for (unsigned k = 0; k < FEATURES; ++k) {
        float value = 0;
        for (unsigned b = 0; b < BANDS; ++b) value += bands[b] * dct[k*BANDS + b];
        vector[k] = value;
        norm += value * value;
    }
    const float scale = 1.0f / fmaxf(sqrtf(norm), 1e-9f);
    for (unsigned k = 0; k < FEATURES; ++k) vector[k] *= scale;
}

static float match(wakeword_t *s, const float vector[FEATURES])
{
    float best = INFINITY, second = INFINITY;
    float *prev = s->dp[s->column], *dest = s->dp[1 - s->column];
    float *last_cost = s->previous_cost;
    const float *ref = template_vectors;
    for (int t = 0; t < TEMPLATE_COUNT; ++t) {
        const int n = template_lengths[t];
        float older = dest[0], preceding_cost = INFINITY;
        dest[0] = 0;
        for (int i = 1; i <= n; ++i) {
            float dot = 0;
            for (int k = 0; k < FEATURES; ++k) dot += vector[k] * *ref++;
            const float cost = fmaxf(0, 1.0f - dot);
            float next = prev[i-1] + cost;
            if (i > 1) next = fminf(next, prev[i-2] + preceding_cost + cost);
            next = fminf(next, older + 0.5f * (last_cost[i] + cost));
            older = dest[i];
            dest[i] = next;
            last_cost[i] = preceding_cost = cost;
        }
        const float score = dest[n] / n;
        if (score < best) { second = best; best = score; }
        else if (score < second) second = score;
        prev += n + 1;
        dest += n + 1;
        last_cost += n + 1;
    }
    s->column ^= 1;
    return 0.5f * (best + second);
}

size_t wakeword_push(wakeword_t *s, const int16_t *pcm, size_t count, float *score, bool *hit)
{
    const size_t space = WAKEWORD_WINDOW - s->filled;
    const size_t take = count < space ? count : space;
    memcpy(s->pcm + s->filled, pcm, take * sizeof(*pcm));
    s->filled += take;
    *score = INFINITY;
    *hit = false;
    if (s->filled == WAKEWORD_WINDOW) {
        float vector[FEATURES];
        features(s, vector);
        *score = match(s, vector);
        if (s->cooldown) --s->cooldown;
        if (!s->cooldown && *score <= threshold) {
            *hit = true;
            s->cooldown = WAKEWORD_RATE / WAKEWORD_HOP;
        }
        s->filled -= WAKEWORD_HOP;
        memmove(s->pcm, s->pcm + WAKEWORD_HOP, s->filled * sizeof(*pcm));
    }
    return take;
}

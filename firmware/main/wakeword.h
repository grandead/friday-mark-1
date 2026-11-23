#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum { WAKEWORD_RATE = 20000, WAKEWORD_WINDOW = 500, WAKEWORD_HOP = 200 };
typedef struct wakeword wakeword_t;
wakeword_t *wakeword_create(void);
void wakeword_reset(wakeword_t *state);
// Push up to the next analysis boundary. Returns the number of samples consumed;
// a finite score is produced whenever a complete analysis window is available.
size_t wakeword_push(wakeword_t *state, const int16_t *pcm, size_t count,
                     float *score, bool *hit);

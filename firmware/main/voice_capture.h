#pragma once
#include "audio_level.h"

// Quiet is relative to the room calibration. Two consecutive loud blocks
// count as speech; a single ADC spike should not extend a recording.
enum { VOICE_QUIET_SAMPLES = AUDIO_SAMPLE_RATE * 3 / 2 };
typedef struct { unsigned quiet_samples, loud_samples; } voice_silence_t;
static inline bool voice_silence_elapsed(voice_silence_t *gate, bool loud, unsigned samples)
{
    gate->loud_samples = loud ? gate->loud_samples + samples : 0;
    if (gate->loud_samples >= AUDIO_SAMPLE_RATE / 25) gate->quiet_samples = 0;
    else gate->quiet_samples += samples;
    return !loud && gate->quiet_samples >= VOICE_QUIET_SAMPLES;
}

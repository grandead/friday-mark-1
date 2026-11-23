#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

void network_start(void);
bool network_connected(void);
bool network_configured(void);
void stream_start(void);
// Called only by the ADC task; must never wait for the network.
void stream_audio(const uint16_t *samples, size_t count, bool calibrated, bool loud);
// Safe for the ADC overflow callback; reports a discontinuity instead of hiding it.
void stream_audio_lost(void);
const char *stream_status(void);
// Called from the ADC task alongside the periodic microphone diagnostics.
void stream_log_button(void);

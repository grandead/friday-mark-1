#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

void wakeword_monitor_start(void);
void wakeword_monitor_audio(const int16_t *pcm, size_t count, bool valid, bool adc_gap, unsigned start_sample);
bool wakeword_take_hit(unsigned *end_sample);

#pragma once
#include <stdbool.h>
#include <stdint.h>

typedef struct {
    float baseline, smooth;
    uint32_t raw, minimum, maximum;
    uint64_t sum;
    unsigned count;
    int64_t calibration_start, candidate_since;
    bool ready, valid, pressed, candidate;
} touch_gate_t;

// ESP32 touch V1 counts fall when capacitance increases.
// Call periodically (nominally every 25 ms), with monotonic microseconds.
void touch_gate_update(touch_gate_t *gate, uint32_t raw, int64_t now);

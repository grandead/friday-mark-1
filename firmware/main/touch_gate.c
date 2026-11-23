#include "touch_gate.h"
#include <string.h>

void touch_gate_update(touch_gate_t *g, uint32_t raw, int64_t now)
{
    g->raw = raw;
    g->valid = raw > 0 && raw < 65535;
    if (!g->valid) {
        g->pressed = g->candidate = false;
        if (!g->ready) { g->count = 0; g->sum = 0; }
        return;
    }
    if (!g->ready) {
        if (!g->count) {
            g->calibration_start = now;
            g->minimum = g->maximum = raw;
        }
        if (raw < g->minimum) g->minimum = raw;
        if (raw > g->maximum) g->maximum = raw;
        g->sum += raw;
        ++g->count;
        if (now - g->calibration_start < 2000000 || g->count < 40) return;
        const float mean = (float)g->sum / g->count;
        if (g->maximum - g->minimum > mean * 0.15f) {
            // A moving hand/wire during setup: require a fresh stable interval.
            g->count = 0; g->sum = 0;
            return;
        }
        g->baseline = g->smooth = mean;
        g->ready = true;
        return;
    }
    g->smooth += 0.3f * (raw - g->smooth);
    const bool detected = g->pressed ? g->smooth < g->baseline * 0.90f
                                     : g->smooth < g->baseline * 0.80f;
    if (detected != g->candidate) { g->candidate = detected; g->candidate_since = now; }
    const int64_t debounce = detected ? 60000 : 150000;
    if (now - g->candidate_since >= debounce) g->pressed = g->candidate;
    // Track slow environmental drift only well outside the touched range.
    // Never learn a held finger as the new baseline, regardless of hold time.
    if (!g->pressed && !g->candidate && g->smooth > g->baseline * 0.95f) {
        g->baseline += 0.001f * (g->smooth - g->baseline);
    }
}

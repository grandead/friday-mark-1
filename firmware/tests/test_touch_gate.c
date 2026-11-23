#include <assert.h>
#include <math.h>
#include <stdio.h>
#include "touch_gate.h"

int main(void)
{
    touch_gate_t gate = {0};
    int64_t now = 0;
    for (; now <= 2000000; now += 25000) touch_gate_update(&gate, 1000, now);
    assert(gate.ready && gate.valid && !gate.pressed);
    assert(fabsf(gate.baseline - 1000) < .01f);
    // An isolated capacitive glitch must not start a recording.
    touch_gate_update(&gate, 400, now); now += 25000;
    for (int i = 0; i < 20; ++i, now += 25000) touch_gate_update(&gate, 1000, now);
    assert(!gate.pressed);
    for (int i = 0; i < 20; ++i, now += 25000) touch_gate_update(&gate, 500, now);
    assert(gate.pressed);
    const float baseline = gate.baseline;
    // No seven-second timeout and no recalibration while a finger is held.
    for (int i = 0; i < 90 * 40; ++i, now += 25000) {
        touch_gate_update(&gate, 500 + (i % 5), now);
        assert(gate.pressed && gate.baseline == baseline);
    }
    // Brief disturbances near release do not chop the recording.
    for (int i = 0; i < 2; ++i, now += 25000) touch_gate_update(&gate, 1000, now);
    assert(gate.pressed);
    for (int i = 0; i < 10; ++i, now += 25000) touch_gate_update(&gate, 500, now);
    assert(gate.pressed);
    for (int i = 0; i < 24; ++i, now += 25000) touch_gate_update(&gate, 1000, now);
    assert(!gate.pressed);
    touch_gate_update(&gate, 0, now);
    assert(!gate.valid && !gate.pressed);
    touch_gate_t unstable = {0};
    for (now = 0; now <= 2000000; now += 25000) {
        touch_gate_update(&unstable, now < 1000000 ? 1000 : 500, now);
    }
    assert(!unstable.ready);
    for (; now < 4500000; now += 25000) touch_gate_update(&unstable, 1000, now);
    assert(unstable.ready && !unstable.pressed);
    puts("PASS: touch calibration, noise rejection, 90-second hold, hysteresis, release and invalid samples");
}

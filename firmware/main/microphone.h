#pragma once

#include <stdbool.h>
#include "audio_level.h"

void microphone_start(bool trial_boot);
bool microphone_latest(audio_level_t *level);

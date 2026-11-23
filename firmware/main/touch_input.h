#pragma once
#include <stdbool.h>
void touch_input_start(void);
bool touch_input_read(bool *valid);
bool touch_input_ready(void);
void touch_input_log(void);

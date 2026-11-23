#pragma once

#include <stdbool.h>

bool ota_pending_verification(void);
void ota_finish_trial(void);
void ota_check_on_boot(void);

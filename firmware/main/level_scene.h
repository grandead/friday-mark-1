#pragma once
#include <stdint.h>

typedef struct { const char *status; } level_scene_t;
uint16_t level_scene_pixel(const level_scene_t *scene, int x, int y);

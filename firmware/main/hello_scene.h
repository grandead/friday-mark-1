#pragma once

#include <stdint.h>

enum { LCD_WIDTH = 240, LCD_HEIGHT = 240 };

// RGB565 pixel value; the SPI transport sends the high byte first.
uint16_t hello_scene_pixel(int x, int y);

#include "hello_scene.h"

#include <stddef.h>
#include <stdint.h>

// Small, original 5x7 bitmap alphabet containing only the demo's characters.
// Each row uses its lowest five bits, most significant pixel first.
typedef struct {
    char character;
    uint8_t rows[7];
} glyph_t;

static const glyph_t GLYPHS[] = {
    {'H', {17, 17, 17, 31, 17, 17, 17}},
    {'e', { 0,  0, 14, 17, 31, 16, 14}},
    {'l', {12,  4,  4,  4,  4,  4, 14}},
    {'o', { 0,  0, 14, 17, 17, 17, 14}},
    {',', { 0,  0,  0,  0,  0,  4,  8}},
    {' ', { 0,  0,  0,  0,  0,  0,  0}},
    {'w', { 0,  0, 17, 17, 21, 21, 10}},
    {'r', { 0,  0, 22, 25, 16, 16, 16}},
    {'d', { 1,  1, 15, 17, 17, 17, 15}},
};

uint16_t hello_scene_pixel(int x, int y)
{
    static const char message[] = "Hello, world";
    const int scale = 3;
    const int text_width = ((int)sizeof(message) - 1) * 6 * scale - scale;
    const int left = (LCD_WIDTH - text_width) / 2;
    const int top = (LCD_HEIGHT - 7 * scale) / 2;
    const uint16_t background = 0x0843; // Dark blue.
    const uint16_t foreground = 0xFFFF;
    const uint16_t accent = 0x07FF;

    if (x >= 24 && x < LCD_WIDTH - 24 && y >= 151 && y < 154) {
        return accent;
    }

    if (x < left || x >= left + text_width || y < top || y >= top + 7 * scale) {
        return background;
    }

    const int cell = (x - left) / (6 * scale);
    const int column = ((x - left) / scale) % 6;
    const int row = (y - top) / scale;
    if (column == 5) {
        return background;
    }

    for (size_t i = 0; i < sizeof(GLYPHS) / sizeof(GLYPHS[0]); ++i) {
        if (GLYPHS[i].character == message[cell]) {
            return (GLYPHS[i].rows[row] & (1U << (4 - column)))
                       ? foreground : background;
        }
    }
    return background;
}

#include "level_scene.h"

#include <stdbool.h>
#include <string.h>

// Original 5x7 glyphs; ASCII indexing makes the per-pixel renderer inexpensive.
static const uint8_t FONT[128][7] = {
    ['0'] = {14,17,19,21,25,17,14}, ['1'] = {4,12,4,4,4,4,14},
    ['2'] = {14,17,1,2,4,8,31}, ['3'] = {30,1,1,14,1,1,30},
    ['4'] = {2,6,10,18,31,2,2}, ['5'] = {31,16,16,30,1,1,30},
    ['6'] = {14,16,16,30,17,17,14}, ['7'] = {31,1,2,4,8,8,8},
    ['8'] = {14,17,17,14,17,17,14}, ['9'] = {14,17,17,15,1,1,14},
    ['A'] = {14,17,17,31,17,17,17}, ['C'] = {14,17,16,16,16,17,14},
    ['B'] = {30,17,17,30,17,17,30},
    ['D'] = {30,17,17,17,17,17,30}, ['E'] = {31,16,16,30,16,16,31},
    ['F'] = {31,16,16,30,16,16,16},
    ['G'] = {14,17,16,23,17,17,15}, ['H'] = {17,17,17,31,17,17,17},
    ['I'] = {14,4,4,4,4,4,14}, ['K'] = {17,18,20,24,20,18,17},
    ['L'] = {16,16,16,16,16,16,31}, ['M'] = {17,27,21,21,17,17,17},
    ['N'] = {17,25,25,21,19,19,17}, ['O'] = {14,17,17,17,17,17,14},
    ['P'] = {30,17,17,30,16,16,16}, ['R'] = {30,17,17,30,20,18,17},
    ['Q'] = {14,17,17,17,21,18,13},
    ['S'] = {15,16,16,14,1,1,30}, ['T'] = {31,4,4,4,4,4,4},
    ['U'] = {17,17,17,17,17,17,14}, ['V'] = {17,17,17,17,17,10,4},
    ['W'] = {17,17,17,21,21,21,10}, ['X'] = {17,17,10,4,10,17,17},
    ['%'] = {25,25,2,4,8,19,19}, ['-'] = {0,0,0,31,0,0,0},
};

static bool text_pixel(const char *text, int top, int scale, int x, int y)
{
    if (y < top || y >= top + 7 * scale) {
        return false;
    }
    const int width = (int)strlen(text) * 6 * scale - scale;
    const int left = (240 - width) / 2;
    if (x < left || x >= left + width) {
        return false;
    }
    const int column = ((x - left) / scale) % 6;
    const unsigned char c = (unsigned char)text[(x - left) / (6 * scale)];
    return column < 5 && c < 128 && (FONT[c][(y - top) / scale] & (1U << (4 - column)));
}

uint16_t level_scene_pixel(const level_scene_t *scene, int x, int y)
{
    const char *status = scene->status;
    if (!status || !*status) return 0;
    if (strcmp(status, "LISTENING") == 0) {
        return text_pixel(status, 106, 4, x, y) ? 0xFFFF : 0;
    }
    if (!text_pixel(status, 182, 2, x, y)) return 0;
    return strcmp(status, "RECORD ERROR") == 0 || strcmp(status, "CLIP") == 0 ||
           strcmp(status, "CHECK INPUT") == 0 || strcmp(status, "RECORD") == 0 ? 0xF9C7 : 0x3F13;
}

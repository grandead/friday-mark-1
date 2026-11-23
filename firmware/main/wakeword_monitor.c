#include "wakeword_monitor.h"
#include "wakeword.h"
#include "audio_level.h"
#include <stdlib.h>
#include <string.h>
#include <stdatomic.h>
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

_Static_assert((int)AUDIO_SAMPLE_RATE == (int)WAKEWORD_RATE, "Model expects 20 kHz PCM");
enum { BLOCK = 512 };
typedef struct {
    unsigned sequence, count, start_sample;
    int16_t pcm[BLOCK];
} audio_block_t;
static QueueHandle_t queue;
static unsigned sequence; // Owned by the microphone task.
static atomic_uint dropped, hit_endpoint;
static atomic_bool hit_pending;
bool wakeword_take_hit(unsigned *end_sample)
{
    if (!atomic_exchange(&hit_pending, false)) return false;
    *end_sample = atomic_load(&hit_endpoint);
    return true;
}
static const char *TAG = "wakeword";

static void observe(void *arg)
{
    wakeword_t *state = arg;
    audio_block_t block;
    unsigned expected = 0, hits = 0, resets = 0, samples = 0;
    int64_t work_us = 0, last_log = esp_timer_get_time();
    while (xQueueReceive(queue, &block, portMAX_DELAY) == pdTRUE) {
        const int64_t start = esp_timer_get_time();
        if (block.sequence != expected) {
            wakeword_reset(state);
            ++resets;
        }
        expected = block.sequence + 1;
        size_t offset = 0;
        while (offset < block.count) {
            float score;
            bool hit;
            offset += wakeword_push(state, block.pcm + offset, block.count - offset, &score, &hit);
            if (hit) {
                atomic_store(&hit_endpoint, block.start_sample + (unsigned)offset);
                atomic_store(&hit_pending, true);
                ESP_LOGI(TAG, "PYATNITSA #%u score=%.4f", ++hits, score);
            }
        }
        samples += block.count;
        const int64_t now = esp_timer_get_time();
        work_us += now - start;
        if (now - last_log >= 10000000) {
            ESP_LOGI(TAG, "audio=%u ms work=%u ms dropped=%u resets=%u hits=%u heap=%u",
                     samples / (WAKEWORD_RATE / 1000), (unsigned)(work_us / 1000),
                     atomic_load(&dropped), resets, hits, (unsigned)esp_get_free_heap_size());
            samples = 0;
            work_us = 0;
            last_log = now;
        }
    }
}

void wakeword_monitor_start(void)
{
    wakeword_t *state = wakeword_create();
    if (state) queue = xQueueCreate(4, sizeof(audio_block_t));
    if (queue && xTaskCreatePinnedToCore(observe, "wakeword", 4096, state, 2, NULL, 1) == pdPASS) {
        ESP_LOGI(TAG, "Observing locally, threshold=0.19063");
        return;
    }
    if (queue) vQueueDelete(queue);
    queue = NULL;
    free(state);
    ESP_LOGE(TAG, "Insufficient RAM to start observer");
}

void wakeword_monitor_audio(const int16_t *pcm, size_t count, bool valid, bool adc_gap, unsigned start_sample)
{
    if (!queue) return;
    if (adc_gap) ++sequence;
    audio_block_t block;
    block.sequence = sequence++;
    block.start_sample = start_sample;
    if (!valid || !count || count > BLOCK) return;
    block.count = count;
    memcpy(block.pcm, pcm, count * sizeof(*pcm));
    if (xQueueSend(queue, &block, 0) != pdTRUE) atomic_fetch_add(&dropped, 1);
}

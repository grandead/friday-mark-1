#include "wakeword_monitor.h"
#include "esp_log.h"

void wakeword_monitor_start(void)
{
    ESP_LOGI("wakeword", "No local templates installed; touch recording is available");
}

bool wakeword_take_hit(unsigned *end_sample)
{
    (void)end_sample;
    return false;
}

void wakeword_monitor_audio(const int16_t *pcm, size_t count, bool valid, bool adc_gap,
                            unsigned start_sample)
{
    (void)pcm;
    (void)count;
    (void)valid;
    (void)adc_gap;
    (void)start_sample;
}

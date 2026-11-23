#include "microphone.h"
#include "stream.h"
#include "wakeword_monitor.h"

#include <string.h>

#include "esp_adc/adc_continuous.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "sdkconfig.h"
#include "soc/soc_caps.h"

enum { SAMPLE_RATE = AUDIO_SAMPLE_RATE, FRAME_SAMPLES = 512, ADC_POOL_SAMPLES = 4096,
       FRAME_BYTES = FRAME_SAMPLES * SOC_ADC_DIGI_RESULT_BYTES };

static const char *TAG = "microphone";
static QueueHandle_t latest_level;
static adc_continuous_handle_t adc;
static adc_channel_t channel;

static bool adc_overflow(adc_continuous_handle_t handle,
                         const adc_continuous_evt_data_t *event, void *context)
{
    (void)handle; (void)event; (void)context;
    stream_audio_lost();
    return false;
}

static void microphone_task(void *argument)
{
    (void)argument;
    uint8_t frame[FRAME_BYTES];
    uint16_t samples[FRAME_SAMPLES];
    unsigned clip_hold_samples = 0;
    unsigned log_samples = 0;
    audio_calibration_t calibration;
    audio_calibration_reset(&calibration);

    while (true) {
        uint32_t bytes_read = 0;
        const esp_err_t err = adc_continuous_read(adc, frame, sizeof(frame), &bytes_read, 1000);
        // An ADC fault should be visible in the serial log, not a frozen meter.
        ESP_ERROR_CHECK(err);
        size_t count = 0;
        for (size_t offset = 0; offset + SOC_ADC_DIGI_RESULT_BYTES <= bytes_read;
             offset += SOC_ADC_DIGI_RESULT_BYTES) {
            adc_digi_output_data_t sample = {0};
            memcpy(&sample, frame + offset, SOC_ADC_DIGI_RESULT_BYTES);
            if (sample.type1.channel == channel) {
                samples[count++] = sample.type1.data;
            }
        }
        if (count == 0) {
            vTaskDelay(1);
            continue;
        }

        audio_level_t level = audio_level_measure(samples, count);
        const bool was_calibrating = !calibration.ready;
        audio_calibration_apply(&calibration, &level, count);
        stream_audio(samples, count, calibration.ready && level.bias_ok,
                     level.rms > calibration.threshold_rms * 1.4f);
        if (was_calibrating && calibration.ready) {
            ESP_LOGI(TAG, "Background calibrated: RMS=%.1f, zero threshold=%.1f",
                     calibration.noise_rms, calibration.threshold_rms);
        }
        if (level.clipped) {
            clip_hold_samples = SAMPLE_RATE / 2;
        } else {
            clip_hold_samples = clip_hold_samples > count ? clip_hold_samples - count : 0;
        }
        level.clipped = clip_hold_samples > 0;
        xQueueOverwrite(latest_level, &level);

        log_samples += count;
        if (log_samples >= SAMPLE_RATE) {
            stream_log_button();
            ESP_LOGI(TAG, "GPIO%d: DC=%.0f RMS=%.1f noise=%.1f cal=%d clip=%d bias_ok=%d",
                     CONFIG_FRIDAY_MIC_GPIO, level.dc, level.rms,
                     level.noise_rms, level.calibrating, level.clipped, level.bias_ok);
            log_samples = 0;
        }
        // Yield even if the DMA pool is catching up after a scheduling delay.
        vTaskDelay(1);
    }
}

void microphone_start(bool trial_boot)
{
    adc_unit_t unit;
    ESP_ERROR_CHECK(adc_continuous_io_to_channel(CONFIG_FRIDAY_MIC_GPIO, &unit, &channel));
    ESP_ERROR_CHECK(unit == ADC_UNIT_1 ? ESP_OK : ESP_ERR_INVALID_ARG);
    ESP_ERROR_CHECK((CONFIG_FRIDAY_MIC_GPIO != CONFIG_FRIDAY_LCD_SCLK &&
                     CONFIG_FRIDAY_MIC_GPIO != CONFIG_FRIDAY_LCD_MOSI &&
                     CONFIG_FRIDAY_MIC_GPIO != CONFIG_FRIDAY_LCD_RESET &&
                     CONFIG_FRIDAY_MIC_GPIO != CONFIG_FRIDAY_LCD_DC) ? ESP_OK : ESP_ERR_INVALID_ARG);

    latest_level = xQueueCreate(1, sizeof(audio_level_t));
    ESP_ERROR_CHECK(latest_level ? ESP_OK : ESP_ERR_NO_MEM);
    const adc_continuous_handle_cfg_t handle_config = {
        .max_store_buf_size = ADC_POOL_SAMPLES * SOC_ADC_DIGI_RESULT_BYTES,
        .conv_frame_size = FRAME_BYTES,
        .flags.flush_pool = false,
    };
    ESP_ERROR_CHECK(adc_continuous_new_handle(&handle_config, &adc));
    adc_digi_pattern_config_t pattern = {
        .atten = ADC_ATTEN_DB_12,
        .channel = channel,
        .unit = unit,
        .bit_width = SOC_ADC_DIGI_MAX_BITWIDTH,
    };
    const adc_continuous_config_t config = {
        .sample_freq_hz = SAMPLE_RATE,
        .conv_mode = ADC_CONV_SINGLE_UNIT_1,
        .format = ADC_DIGI_OUTPUT_FORMAT_TYPE1,
        .pattern_num = 1,
        .adc_pattern = &pattern,
    };
    ESP_ERROR_CHECK(adc_continuous_config(adc, &config));
    const adc_continuous_evt_cbs_t callbacks = {.on_pool_ovf = adc_overflow};
    ESP_ERROR_CHECK(adc_continuous_register_event_callbacks(adc, &callbacks, NULL));
    ESP_ERROR_CHECK(adc_continuous_start(adc));
    if (trial_boot) {
        // Quiesce ADC DMA before the trial writes otadata with the flash cache disabled.
        ESP_ERROR_CHECK(adc_continuous_stop(adc));
        return;
    }
    if (!FRIDAY_RAM_CAPTURE_TEST) wakeword_monitor_start();
    ESP_ERROR_CHECK(xTaskCreate(microphone_task, "microphone", 8192, NULL, 5, NULL)
                    == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
    ESP_LOGI(TAG, "MAX9814 OUT -> GPIO%d (ADC1 channel %d), %d samples/s, %d samples/frame",
             CONFIG_FRIDAY_MIC_GPIO, channel, SAMPLE_RATE, FRAME_SAMPLES);
}

bool microphone_latest(audio_level_t *level)
{
    return xQueuePeek(latest_level, level, 0) == pdTRUE;
}

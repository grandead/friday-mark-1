#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "driver/spi_master.h"
#include "esp_check.h"
#include "esp_heap_caps.h"
#include "esp_lcd_io_spi.h"
#include "esp_lcd_panel_io.h"
#include "esp_lcd_panel_ops.h"
#include "esp_lcd_panel_vendor.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "sdkconfig.h"

#include "hello_scene.h"
#include "level_scene.h"
#include "microphone.h"
#include "ota.h"
#include "esp_ota_ops.h"
#include "stream.h"
#include "touch_input.h"

static const char *TAG = "friday";
enum { STRIPE_ROWS = 16, STRIPE_BYTES = LCD_WIDTH * STRIPE_ROWS * 2 };

static bool color_transfer_done(esp_lcd_panel_io_handle_t io,
                                esp_lcd_panel_io_event_data_t *event,
                                void *context)
{
    (void)io;
    (void)event;
    BaseType_t task_woken = pdFALSE;
    xSemaphoreGiveFromISR((SemaphoreHandle_t)context, &task_woken);
    return task_woken == pdTRUE;
}

static void draw_screen(esp_lcd_panel_handle_t panel, uint8_t *pixels,
                        SemaphoreHandle_t transfer_done, const level_scene_t *scene,
                        int first_y, int last_y)
{
    for (int y = first_y; y < last_y; y += STRIPE_ROWS) {
        const int rows = (last_y - y < STRIPE_ROWS) ? last_y - y : STRIPE_ROWS;
        for (int row = 0; row < rows; ++row) {
            for (int x = 0; x < LCD_WIDTH; ++x) {
                const uint16_t color = scene ? level_scene_pixel(scene, x, y + row)
                                             : hello_scene_pixel(x, y + row);
                const int offset = (row * LCD_WIDTH + x) * 2;
                pixels[offset] = color >> 8;
                pixels[offset + 1] = color & 0xFF;
            }
        }
        ESP_ERROR_CHECK(esp_lcd_panel_draw_bitmap(panel, 0, y, LCD_WIDTH, y + rows, pixels));
        // draw_bitmap queues DMA; keep this buffer unchanged until its callback.
        if (xSemaphoreTake(transfer_done, pdMS_TO_TICKS(2000)) != pdTRUE) {
            ESP_LOGE(TAG, "SPI transfer timed out");
            abort();
        }
    }
}

void app_main(void)
{
    ESP_LOGI(TAG, "ST7789: SCL=%d SDA=%d RES=%d DC=%d, SPI mode %d, %d MHz",
             CONFIG_FRIDAY_LCD_SCLK, CONFIG_FRIDAY_LCD_MOSI,
             CONFIG_FRIDAY_LCD_RESET, CONFIG_FRIDAY_LCD_DC,
             CONFIG_FRIDAY_LCD_SPI_MODE, CONFIG_FRIDAY_LCD_CLOCK_MHZ);

    SemaphoreHandle_t transfer_done = xSemaphoreCreateBinary();
    ESP_ERROR_CHECK(transfer_done ? ESP_OK : ESP_ERR_NO_MEM);
    uint8_t *pixels = heap_caps_malloc(STRIPE_BYTES, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
    ESP_ERROR_CHECK(pixels ? ESP_OK : ESP_ERR_NO_MEM);

    const spi_bus_config_t bus_config = {
        .sclk_io_num = CONFIG_FRIDAY_LCD_SCLK,
        .mosi_io_num = CONFIG_FRIDAY_LCD_MOSI,
        .miso_io_num = -1,
        .quadwp_io_num = -1,
        .quadhd_io_num = -1,
        .max_transfer_sz = STRIPE_BYTES,
    };
    ESP_ERROR_CHECK(spi_bus_initialize(SPI2_HOST, &bus_config, SPI_DMA_CH_AUTO));

    esp_lcd_panel_io_handle_t io = NULL;
    const esp_lcd_panel_io_spi_config_t io_config = {
        .cs_gpio_num = -1, // Seven-pin display: CS is not exposed; dedicated bus.
        .dc_gpio_num = CONFIG_FRIDAY_LCD_DC,
        .spi_mode = CONFIG_FRIDAY_LCD_SPI_MODE,
        .pclk_hz = CONFIG_FRIDAY_LCD_CLOCK_MHZ * 1000000,
        .trans_queue_depth = 1,
        .lcd_cmd_bits = 8,
        .lcd_param_bits = 8,
        .on_color_trans_done = color_transfer_done,
        .user_ctx = transfer_done,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_io_spi(SPI2_HOST, &io_config, &io));

    esp_lcd_panel_handle_t panel = NULL;
    const esp_lcd_panel_dev_config_t panel_config = {
        .reset_gpio_num = CONFIG_FRIDAY_LCD_RESET,
#ifdef CONFIG_FRIDAY_LCD_BGR
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_BGR,
#else
        .rgb_ele_order = LCD_RGB_ELEMENT_ORDER_RGB,
#endif
        .bits_per_pixel = 16,
    };
    ESP_ERROR_CHECK(esp_lcd_new_panel_st7789(io, &panel_config, &panel));
    ESP_ERROR_CHECK(esp_lcd_panel_reset(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_init(panel));
    ESP_ERROR_CHECK(esp_lcd_panel_swap_xy(panel, false));
    ESP_ERROR_CHECK(esp_lcd_panel_mirror(panel, false, false));
    ESP_ERROR_CHECK(esp_lcd_panel_set_gap(panel, CONFIG_FRIDAY_LCD_X_GAP,
                                       CONFIG_FRIDAY_LCD_Y_GAP));
#ifdef CONFIG_FRIDAY_LCD_INVERT
    ESP_ERROR_CHECK(esp_lcd_panel_invert_color(panel, true));
#else
    ESP_ERROR_CHECK(esp_lcd_panel_invert_color(panel, false));
#endif

#ifdef CONFIG_FRIDAY_MIC_ENABLE
    audio_level_t level = {0};
    level_scene_t scene;
    scene.status = network_configured() ? "WIFI CONNECTING" : "SETUP WIFI";
    draw_screen(panel, pixels, transfer_done, &scene, 0, LCD_HEIGHT);
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));
#else
    draw_screen(panel, pixels, transfer_done, NULL, 0, LCD_HEIGHT);
    ESP_ERROR_CHECK(esp_lcd_panel_disp_on_off(panel, true));
    ESP_LOGI(TAG, "Hello, world drawn; BLK must be connected to 3V3.");
    if (!network_configured() && !ota_pending_verification()) {
        free(pixels);
        return;
    }
#endif

    const bool trial = ota_pending_verification();
    network_start();
    const TickType_t wifi_start = xTaskGetTickCount();
    while (!network_connected()) {
        if (trial && xTaskGetTickCount() - wifi_start >= pdMS_TO_TICKS(60000)) {
            ESP_LOGE(TAG, "OTA trial could not join Wi-Fi; rolling back");
            ESP_ERROR_CHECK(esp_ota_mark_app_invalid_rollback_and_reboot());
        }
#ifdef CONFIG_FRIDAY_MIC_ENABLE
        scene.status = stream_status();
        draw_screen(panel, pixels, transfer_done, &scene, 64, 208);
#endif
        vTaskDelay(pdMS_TO_TICKS(250));
    }
    if (!trial) {
#ifdef CONFIG_FRIDAY_MIC_ENABLE
        scene.status = "OTA CHECK";
        draw_screen(panel, pixels, transfer_done, &scene, 64, 208);
#endif
        ota_check_on_boot();
    }

#ifdef CONFIG_FRIDAY_MIC_ENABLE
    stream_start();
    microphone_start(trial);
    if (trial) ota_finish_trial();
    ESP_LOGI(TAG, "Voice capture ready; BLK must be connected to 3V3.");
    TickType_t next_frame = xTaskGetTickCount();
    const char *displayed = NULL;
    while (true) {
        const bool ready = microphone_latest(&level);
        const char *status = stream_status();
        if (network_connected() && touch_input_ready() && !*status) {
            status = !ready ? "WAITING" : !level.bias_ok ? "CHECK INPUT" :
                     level.calibrating ? "QUIET PLEASE" : level.clipped ? "CLIP" : "";
        }
        if (!displayed || strcmp(displayed, status) != 0) {
            scene.status = status;
            draw_screen(panel, pixels, transfer_done, &scene, 96, 208);
            displayed = status;
        }
        vTaskDelayUntil(&next_frame, pdMS_TO_TICKS(100));
    }
#else
    free(pixels);
    if (trial) ota_finish_trial();
#endif
}

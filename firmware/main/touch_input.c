#include "touch_input.h"
#include "touch_gate.h"
#include <stdatomic.h>
#include "driver/touch_sens.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "touch";
static touch_channel_handle_t channel;
static touch_gate_t gate;
static atomic_bool ready;

void touch_input_start(void)
{
    touch_sensor_handle_t sensor;
    touch_sensor_sample_config_t sample =
        TOUCH_SENSOR_V1_DEFAULT_SAMPLE_CONFIG(5.0, TOUCH_VOLT_LIM_L_0V5, TOUCH_VOLT_LIM_H_1V7);
    touch_sensor_config_t config = TOUCH_SENSOR_DEFAULT_BASIC_CONFIG(1, &sample);
    ESP_ERROR_CHECK(touch_sensor_new_controller(&config, &sensor));
    const touch_channel_config_t chan_config = {
        .abs_active_thresh = {0}, // We apply software hysteresis to raw counts.
        .charge_speed = TOUCH_CHARGE_SPEED_7,
        .init_charge_volt = TOUCH_INIT_CHARGE_VOLT_DEFAULT,
        .group = TOUCH_CHAN_TRIG_GROUP_BOTH,
    };
    ESP_ERROR_CHECK(touch_sensor_new_channel(sensor, 7, &chan_config, &channel));
    touch_chan_info_t info = {0};
    ESP_ERROR_CHECK(touch_sensor_get_channel_info(channel, &info));
    ESP_ERROR_CHECK(info.chan_gpio == 27 ? ESP_OK : ESP_ERR_INVALID_STATE);
    // This IDF version's touch V1 read API requires SMOOTH data and a filter.
    // Configure it before enabling/scanning; avoid polling hardware in the ADC task.
    const touch_sensor_filter_config_t filter = TOUCH_SENSOR_DEFAULT_FILTER_CONFIG();
    ESP_ERROR_CHECK(touch_sensor_config_filter(sensor, &filter));
    ESP_ERROR_CHECK(touch_sensor_enable(sensor));
    // Seed sensor data before starting the ADC task. Subsequent reads use the
    // driver's filtered cache while hardware scans independently.
    for (int i = 0; i < 3; ++i) {
        ESP_ERROR_CHECK(touch_sensor_trigger_oneshot_scanning(sensor, 1000));
    }
    ESP_ERROR_CHECK(touch_sensor_start_continuous_scanning(sensor));
    ESP_LOGI(TAG, "GPIO27 / TOUCH7: keep electrode untouched during calibration");
}

bool touch_input_read(bool *valid)
{
    uint32_t raw = 0;
    const esp_err_t error = touch_channel_read_data(channel, TOUCH_CHAN_DATA_TYPE_SMOOTH, &raw);
    const bool was_ready = gate.ready;
    touch_gate_update(&gate, error == ESP_OK ? raw : 0, esp_timer_get_time());
    *valid = gate.ready && gate.valid;
    atomic_store(&ready, *valid);
    if (!was_ready && gate.ready) {
        ESP_LOGI(TAG, "Calibrated: baseline=%.0f press<%.0f release>=%.0f",
                 gate.baseline, gate.baseline * 0.8f, gate.baseline * 0.9f);
    }
    return gate.pressed;
}

bool touch_input_ready(void) { return atomic_load(&ready); }

void touch_input_log(void)
{
    ESP_LOGI(TAG, "GPIO27: value=%lu smooth=%.0f base=%.0f press<%.0f release>=%.0f ready=%d valid=%d touched=%d",
             (unsigned long)gate.raw, gate.smooth, gate.baseline,
             gate.baseline * .8f, gate.baseline * .9f, gate.ready, gate.valid, gate.pressed);
}

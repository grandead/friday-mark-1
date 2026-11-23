#include "ota.h"

#include <stdio.h>
#include "esp_https_ota.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "ota_config.h"

bool ota_pending_verification(void)
{
    esp_ota_img_states_t state;
    return esp_ota_get_state_partition(esp_ota_get_running_partition(), &state) == ESP_OK &&
           state == ESP_OTA_IMG_PENDING_VERIFY;
}

void ota_finish_trial(void)
{
    ESP_LOGI("ota", "Trial startup passed, marking image valid");
    ESP_ERROR_CHECK(esp_ota_mark_app_valid_cancel_rollback());
    ESP_LOGI("ota", "Trial image confirmed");
    // Reconnect before allocating audio buffers so the Mac can verify the running image.
    esp_restart();
}

static esp_err_t request_headers(esp_http_client_handle_t client)
{
    uint8_t digest[32];
    esp_err_t err = esp_partition_get_sha256(esp_ota_get_running_partition(), digest);
    if (err != ESP_OK) return err;
    char hex[65];
    for (size_t i = 0; i < sizeof(digest); ++i) {
        snprintf(hex + i * 2, 3, "%02x", digest[i]);
    }
    err = esp_http_client_set_header(client, "X-Friday-Image", hex);
    if (err != ESP_OK) return err;
    return esp_http_client_set_header(client, "Authorization", FRIDAY_OTA_AUTH);
}

void ota_check_on_boot(void)
{
    if (FRIDAY_OTA_HOST[0] == '\0') return;
    const esp_http_client_config_t http = {
        .url = "https://" FRIDAY_OTA_HOST ":" FRIDAY_OTA_PORT "/firmware.bin",
        .cert_pem = FRIDAY_OTA_CERT,
        .common_name = FRIDAY_OTA_CERT_NAME,
        .timeout_ms = 4000,
        .disable_auto_redirect = true,
        .max_authorization_retries = -1,
    };
    const esp_https_ota_config_t ota = {
        .http_config = &http,
        .http_client_init_cb = request_headers,
    };
    esp_err_t err = esp_https_ota(&ota);
    if (err == ESP_OK) {
        ESP_LOGI("ota", "New image verified. Restarting.");
        esp_restart();
    }
    ESP_LOGI("ota", "Boot update check: %s", esp_err_to_name(err));
}

#include "stream.h"
#include "audio_level.h"
#include "audio_pcm.h"
#include "voice_capture.h"
#include "wakeword_monitor.h"
#include "touch_input.h"

#include <stdatomic.h>
#include <stdio.h>
#include <string.h>
#include "driver/gpio.h"
#include "esp_check.h"
#include "esp_event.h"
#include "esp_heap_caps.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_system.h"
#include "esp_transport_tcp.h"
#include "esp_transport_ws.h"
#include "lwip/sockets.h"
#include "esp_websocket_client.h"
#include "esp_wifi.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "sdkconfig.h"

#if __has_include("network_config.h")
#include "network_config.h"
#else
#define FRIDAY_WIFI_SSID ""
#define FRIDAY_WIFI_PASSWORD ""
#define FRIDAY_SERVER_URI "ws://localhost:33000/audio"
#endif

static const char *TAG = "stream";
enum { PACKET_SAMPLES = 512, QUEUE_PACKETS = FRIDAY_RAM_CAPTURE_TEST ? 1 : 72, BLOCKS_PER_MESSAGE = 6,
       MESSAGE_SAMPLES = PACKET_SAMPLES * BLOCKS_PER_MESSAGE,
       RECORDING_RATE = FRIDAY_RAM_CAPTURE_TEST ? PCM_RATE : AUDIO_SAMPLE_RATE };
typedef enum { PACKET_START, PACKET_AUDIO, PACKET_END, PACKET_RAM_CLIP, PACKET_PAUSE_RADIO } packet_kind_t;
typedef struct {
    packet_kind_t kind;
    unsigned session;
    unsigned count;
    int16_t pcm[PACKET_SAMPLES];
} packet_t;
static QueueHandle_t outgoing;
static TaskHandle_t sender;
typedef enum { RADIO_NORMAL, RADIO_STOPPING, RADIO_OFF, RADIO_RESTORING } radio_phase_t;
static _Atomic(radio_phase_t) radio_phase;
static atomic_uint offline_samples;
static esp_websocket_client_handle_t websocket;
static esp_transport_handle_t websocket_transport;
static atomic_bool wifi_up, socket_up, capturing, busy, capture_error, adc_overflow;
static atomic_uint failed_session;
// Only the ADC task accesses these variables.
static unsigned session, sample_total;
static size_t discard_samples;
static bool active, armed, button_stable;
static atomic_bool voice_session;
static voice_silence_t silence;
static bool silence_elapsed;
#if !FRIDAY_RAM_CAPTURE_TEST
// Replay samples acquired while the detector task was finishing its match.
enum { HISTORY = 4096 };
static int16_t history[HISTORY];
static unsigned sample_clock, history_count;

static void remember_audio(const int16_t *pcm, unsigned count, unsigned start)
{
    unsigned pos = start % HISTORY;
    unsigned first = count < HISTORY - pos ? count : HISTORY - pos;
    memcpy(history + pos, pcm, first * sizeof(*pcm));
    memcpy(history, pcm + first, (count - first) * sizeof(*pcm));
    history_count += count;
    if (history_count > HISTORY) history_count = HISTORY;
}
#endif
static int64_t started_at;
static audio_pcm_filter_t filter;
static int16_t *pcm_buffer;
#if FRIDAY_RAM_CAPTURE_TEST
static pcm_resampler_t resampler;
#if FRIDAY_FIR_PAIR_TEST
_Static_assert(PACKET_SAMPLES == (int)FIR_TEST_FRAME, "FIR diagnostic frame capacity mismatch");
static pcm_pair_t fir_pair;
#endif
#endif
enum { PAGE_SAMPLES = 1024, MAX_PAGES = 160, HEAP_RESERVE = 32 * 1024 };
static int16_t *pages[MAX_PAGES];
static unsigned ram_capacity;
static atomic_bool clip_full;

static void allocate_clip(void)
{
    const unsigned caps = MALLOC_CAP_INTERNAL | MALLOC_CAP_8BIT;
    const size_t bytes = PAGE_SAMPLES * sizeof(int16_t);
    for (unsigned i = 0; i < MAX_PAGES; ++i) {
        if (heap_caps_get_free_size(caps) < HEAP_RESERVE + bytes + 32) break;
        pages[i] = heap_caps_malloc(bytes, caps);
        if (!pages[i]) break;
        ram_capacity += PAGE_SAMPLES;
    }
    ESP_LOGI(TAG, "PCM16 RAM: %u samples at %d Hz (%u ms), free heap %u bytes",
             ram_capacity, PCM_RATE, ram_capacity * 1000 / PCM_RATE, (unsigned)heap_caps_get_free_size(caps));
}
#define FRIDAY_DEVICE_ID "01a20858-a582-724b-950b-855d0dfa5bec"
#define FRIDAY_USER_ID "01a20858-a582-7fa5-b8a6-a8b5bccf8b4a"
static char start_message[192];

static bool radio_suspended(void)
{
    radio_phase_t phase = atomic_load(&radio_phase);
    return phase == RADIO_STOPPING || phase == RADIO_OFF;
}

static void wifi_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg; (void)data;
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_START && !radio_suspended()) esp_wifi_connect();
    if (base == WIFI_EVENT && id == WIFI_EVENT_STA_DISCONNECTED) {
        atomic_store(&wifi_up, false);
        atomic_store(&socket_up, false);
        if (radio_suspended()) return;
        if (atomic_load(&radio_phase) == RADIO_NORMAL && atomic_load(&busy)) atomic_store(&capture_error, true);
        ESP_LOGW(TAG, "Wi-Fi disconnected; reconnecting");
        esp_wifi_connect();
    }
    if (base == IP_EVENT && id == IP_EVENT_STA_GOT_IP) {
        atomic_store(&wifi_up, true);
        ESP_LOGI(TAG, "Wi-Fi connected");
    }
}

bool network_configured(void) { return strlen(FRIDAY_WIFI_SSID) > 0; }
bool network_connected(void) { return atomic_load(&wifi_up); }
void network_start(void)
{
    if (!network_configured()) {
        ESP_LOGW(TAG, "Run scripts/configure-network.py and rebuild to configure Wi-Fi");
        return;
    }
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    ESP_ERROR_CHECK(esp_netif_create_default_wifi_sta() ? ESP_OK : ESP_ERR_NO_MEM);
    wifi_init_config_t init = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&init));
    ESP_ERROR_CHECK(esp_event_handler_register(WIFI_EVENT, ESP_EVENT_ANY_ID, wifi_event, NULL));
    ESP_ERROR_CHECK(esp_event_handler_register(IP_EVENT, IP_EVENT_STA_GOT_IP, wifi_event, NULL));
    wifi_config_t config = {0};
    _Static_assert(sizeof(FRIDAY_WIFI_SSID) <= 33, "SSID too long");
    _Static_assert(sizeof(FRIDAY_WIFI_PASSWORD) <= 64, "Password too long");
    memcpy(config.sta.ssid, FRIDAY_WIFI_SSID, strlen(FRIDAY_WIFI_SSID));
    memcpy(config.sta.password, FRIDAY_WIFI_PASSWORD, strlen(FRIDAY_WIFI_PASSWORD));
    config.sta.pmf_cfg.capable = true;
    ESP_ERROR_CHECK(esp_wifi_set_storage(WIFI_STORAGE_RAM));
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &config));
    ESP_ERROR_CHECK(esp_wifi_start());
    ESP_ERROR_CHECK(esp_wifi_set_ps(WIFI_PS_NONE));
}

static void websocket_event(void *arg, esp_event_base_t base, int32_t id, void *data)
{
    (void)arg; (void)base; (void)data;
    if (id == WEBSOCKET_EVENT_CONNECTED) {
        const int enabled = 1;
        const int socket = esp_transport_get_socket(websocket_transport);
        if (setsockopt(socket, IPPROTO_TCP, TCP_NODELAY, &enabled, sizeof(enabled)) != 0) {
            ESP_LOGW(TAG, "Could not enable TCP_NODELAY");
        }
        atomic_store(&socket_up, true);
        ESP_LOGI(TAG, "Audio server connected");
    } else if (id == WEBSOCKET_EVENT_DISCONNECTED || id == WEBSOCKET_EVENT_CLOSED || id == WEBSOCKET_EVENT_ERROR) {
        ESP_LOGW(TAG, "Audio server event %ld; connection unavailable", (long)id);
        atomic_store(&socket_up, false);
        // Latch the failure even if reconnection finishes between ADC frames.
        if (atomic_load(&radio_phase) == RADIO_NORMAL && atomic_load(&busy)) atomic_store(&capture_error, true);
    }
}

static bool send_text(const char *text)
{
    const int size = strlen(text);
    return atomic_load(&socket_up) &&
        esp_websocket_client_send_text(websocket, text, size, pdMS_TO_TICKS(3000)) == size;
}

static bool send_pcm(const int16_t *pcm, unsigned count)
{
    const int size = count * sizeof(*pcm);
    const int64_t before = esp_timer_get_time();
    const bool ok = atomic_load(&socket_up) &&
        esp_websocket_client_send_bin(websocket, (const char *)pcm, size, pdMS_TO_TICKS(3000)) == size;
    const int elapsed_ms = (esp_timer_get_time() - before) / 1000;
    if (elapsed_ms > 100) {
        ESP_LOGW(TAG, "Audio send took %d ms; queued=%u/%d", elapsed_ms,
                 (unsigned)uxQueueMessagesWaiting(outgoing), QUEUE_PACKETS);
    }
    return ok;
}

static bool send_end(unsigned samples)
{
    char end[80];
    snprintf(end, sizeof(end), "{\"type\":\"end\",\"samples\":%u}", samples);
    return send_text(end);
}

static bool send_buffer(unsigned samples)
{
    if (FRIDAY_RAM_CAPTURE_TEST) {
        for (unsigned i = 0; i < samples; i += PAGE_SAMPLES) {
            unsigned remaining = samples - i;
            if (!send_pcm(pages[i / PAGE_SAMPLES], remaining < PAGE_SAMPLES ? remaining : PAGE_SAMPLES)) return false;
        }
        return true;
    }
    for (unsigned i = 0; i < samples; i += MESSAGE_SAMPLES) {
        unsigned remaining = samples - i;
        if (!send_pcm(pcm_buffer + i, remaining < MESSAGE_SAMPLES ? remaining : MESSAGE_SAMPLES)) return false;
    }
    return true;
}

// The ADC task keeps draining DMA while the sender stops and restarts the network.
static void send_radio_off_clip(unsigned id)
{
    bool ws_stopped = esp_websocket_client_stop(websocket) == ESP_OK;
    bool wifi_stopped = ws_stopped && esp_wifi_stop() == ESP_OK;
    if (wifi_stopped) {
        atomic_store(&wifi_up, false);
        atomic_store(&socket_up, false);
        ESP_LOGI(TAG, "Clip %u: Wi-Fi stopped", id);
        atomic_store(&radio_phase, RADIO_OFF);
    } else {
        ESP_LOGE(TAG, "Clip %u: could not stop network", id);
        atomic_store(&capture_error, true);
    }
    ulTaskNotifyTake(pdTRUE, portMAX_DELAY); // release or capture failure, including a short tap
    const unsigned count = atomic_load(&offline_samples);
    atomic_store(&radio_phase, RADIO_RESTORING);
    ESP_LOGI(TAG, "Clip %u: restoring network, %u samples buffered", id, count);
    if (wifi_stopped) {
        while (esp_wifi_start() != ESP_OK) vTaskDelay(pdMS_TO_TICKS(1000));
    } else if (!network_connected()) {
        esp_wifi_connect();
    }
    if (ws_stopped) {
        while (!network_connected()) vTaskDelay(pdMS_TO_TICKS(100));
        while (esp_websocket_client_start(websocket) != ESP_OK) vTaskDelay(pdMS_TO_TICKS(1000));
    }
    if (count) {
        while (!atomic_load(&socket_up)) vTaskDelay(pdMS_TO_TICKS(100));
        if (send_text(start_message) && send_buffer(count) && send_end(count)) {
            ESP_LOGI(TAG, "Clip %u: upload complete", id);
        } else {
            atomic_store(&capture_error, true);
            esp_websocket_client_stop(websocket);
            atomic_store(&socket_up, false);
            esp_websocket_client_start(websocket);
        }
    }
    atomic_store(&radio_phase, RADIO_NORMAL);
    atomic_store(&busy, false);
}

static void sender_task(void *argument)
{
    (void)argument;
    packet_t packet;
    unsigned buffered = 0;
    unsigned sending = 0;
    while (true) {
        if (xQueueReceive(outgoing, &packet, pdMS_TO_TICKS(50)) != pdTRUE) {
            // An overflow may leave no space for an explicit abort packet.
            if (sending && (atomic_load(&failed_session) == sending || atomic_load(&capture_error))) {
                send_text("{\"type\":\"abort\"}");
                sending = 0;
                atomic_store(&busy, false);
            }
            continue;
        }
        if (FRIDAY_WIFI_OFF_CAPTURE && packet.kind == PACKET_PAUSE_RADIO) {
            send_radio_off_clip(packet.session);
            continue;
        }
        if (packet.session == atomic_load(&failed_session) || atomic_load(&capture_error)) {
            if (sending) send_text("{\"type\":\"abort\"}");
            sending = 0;
            atomic_store(&busy, false);
            continue;
        }
        bool ok = true;
        if (FRIDAY_RAM_CAPTURE_TEST && packet.kind == PACKET_RAM_CLIP) {
            ok = send_text(start_message) && send_buffer(packet.count) && send_end(packet.count);
            if (ok) atomic_store(&busy, false);
        } else if (packet.kind == PACKET_START) {
            buffered = 0;
            sending = packet.session;
            ok = send_text(start_message);
        } else if (packet.session == sending && packet.kind == PACKET_AUDIO) {
            unsigned offset = 0;
            while (ok && offset < packet.count) {
                const unsigned room = MESSAGE_SAMPLES - buffered;
                const unsigned left = packet.count - offset;
                const unsigned take = left < room ? left : room;
                memcpy(pcm_buffer + buffered, packet.pcm + offset, take * sizeof(*pcm_buffer));
                buffered += take;
                offset += take;
                if (buffered == MESSAGE_SAMPLES) {
                    ok = send_buffer(buffered);
                    buffered = 0;
                }
            }
        } else if (packet.session == sending && packet.kind == PACKET_END) {
            ok = send_buffer(buffered) && send_end(packet.count);
            sending = 0;
            atomic_store(&busy, false);
        }
        if (!ok) {
            atomic_store(&failed_session, packet.session);
            atomic_store(&capture_error, true);
            // Stop the session entirely; never finalize a recording with missing frames.
            esp_websocket_client_stop(websocket);
            atomic_store(&socket_up, false);
            sending = 0;
            atomic_store(&busy, false);
            esp_websocket_client_start(websocket);
        }
    }
}

void stream_start(void)
{
    snprintf(start_message, sizeof(start_message),
             "{\"type\":\"start\",\"deviceId\":\"" FRIDAY_DEVICE_ID "\","
             "\"userId\":\"" FRIDAY_USER_ID "\",\"sampleRate\":%d,"
             "\"channels\":1,\"format\":\"s16le\"}", RECORDING_RATE);
#if FRIDAY_RAM_CAPTURE_TEST && FRIDAY_FIR_PAIR_TEST
    ESP_LOGI(TAG, "FIR diagnostic: %s, emit previous PCM frame",
             FRIDAY_FIR_PAIR_CONTROL ? "resample each ADC frame" : "resample every two ADC frames");
#endif
    ESP_ERROR_CHECK((CONFIG_FRIDAY_BUTTON_GPIO != CONFIG_FRIDAY_LCD_SCLK &&
                     CONFIG_FRIDAY_BUTTON_GPIO != CONFIG_FRIDAY_LCD_MOSI &&
                     CONFIG_FRIDAY_BUTTON_GPIO != CONFIG_FRIDAY_LCD_RESET &&
                     CONFIG_FRIDAY_BUTTON_GPIO != CONFIG_FRIDAY_LCD_DC &&
                     CONFIG_FRIDAY_BUTTON_GPIO != CONFIG_FRIDAY_MIC_GPIO) ? ESP_OK : ESP_ERR_INVALID_ARG);
    ESP_ERROR_CHECK(CONFIG_FRIDAY_BUTTON_GPIO == 27 ? ESP_OK : ESP_ERR_INVALID_ARG);
    // The touch driver owns GPIO27: no digital input pulls or module output.
    touch_input_start();
    outgoing = xQueueCreate(QUEUE_PACKETS, sizeof(packet_t));
    ESP_ERROR_CHECK(outgoing ? ESP_OK : ESP_ERR_NO_MEM);
    esp_transport_handle_t tcp = esp_transport_tcp_init();
    ESP_ERROR_CHECK(tcp ? ESP_OK : ESP_ERR_NO_MEM);
    websocket_transport = esp_transport_ws_init(tcp);
    ESP_ERROR_CHECK(websocket_transport ? ESP_OK : ESP_ERR_NO_MEM);
    esp_transport_set_default_port(websocket_transport, 80);
    const char *path = strchr(FRIDAY_SERVER_URI + strlen("ws://"), '/');
    const esp_transport_ws_config_t transport_config = {
        .ws_path = path ? path : "/audio",
        .propagate_control_frames = true,
    };
    ESP_ERROR_CHECK(esp_transport_ws_set_config(websocket_transport, &transport_config));
    const esp_websocket_client_config_t config = {
        .uri = FRIDAY_SERVER_URI,
        .ext_transport = websocket_transport,
        .reconnect_timeout_ms = 2000,
        .enable_close_reconnect = true,
        .network_timeout_ms = 5000,
        .buffer_size = MESSAGE_SAMPLES * sizeof(int16_t),
        .task_stack = 4096,
    };
    websocket = esp_websocket_client_init(&config);
    ESP_ERROR_CHECK(websocket ? ESP_OK : ESP_ERR_NO_MEM);
    ESP_ERROR_CHECK(esp_websocket_register_events(websocket, WEBSOCKET_EVENT_ANY, websocket_event, NULL));
    ESP_ERROR_CHECK(esp_websocket_client_start(websocket));
    ESP_ERROR_CHECK(xTaskCreate(sender_task, "audio_sender", 4096, NULL, 4, &sender) == pdPASS ? ESP_OK : ESP_ERR_NO_MEM);
    if (FRIDAY_WIFI_OFF_CAPTURE) ESP_LOGI(TAG, "Wi-Fi off during RAM capture enabled");
    if (!FRIDAY_RAM_CAPTURE_TEST) {
        pcm_buffer = heap_caps_malloc(MESSAGE_SAMPLES * sizeof(*pcm_buffer), MALLOC_CAP_8BIT);
        ESP_ERROR_CHECK(pcm_buffer ? ESP_OK : ESP_ERR_NO_MEM);
        ESP_LOGI(TAG, "Audio messages: %d samples (%d ms)", MESSAGE_SAMPLES, MESSAGE_SAMPLES * 1000 / RECORDING_RATE);
    }
    ESP_LOGI(TAG, "Audio queue: %d frames; free heap: %lu bytes", QUEUE_PACKETS,
             (unsigned long)esp_get_free_heap_size());
}

void stream_audio_lost(void) { atomic_store(&adc_overflow, true); }

static void fail_capture(const char *reason)
{
    ESP_LOGW(TAG, "Recording %u interrupted: %s; queued=%u/%d", session, reason,
             (unsigned)uxQueueMessagesWaiting(outgoing), QUEUE_PACKETS);
    atomic_store(&failed_session, session);
    atomic_store(&capture_error, true);
    atomic_store(&capturing, false);
    // An aborted RAM capture has never been handed to the sender.
    if (FRIDAY_WIFI_OFF_CAPTURE && active) {
        atomic_store(&offline_samples, 0);
        xTaskNotifyGive(sender);
    } else if (FRIDAY_RAM_CAPTURE_TEST) {
        atomic_store(&busy, false);
    }
    active = false;
}

void stream_audio(const uint16_t *samples, size_t count, bool calibrated, bool loud)
{
    if (!outgoing) return;
    packet_t packet = {.kind = PACKET_AUDIO, .session = session, .count = count};
    if (count > PACKET_SAMPLES) { if (active) fail_capture("oversized ADC frame"); return; }
    audio_pcm_convert(&filter, samples, packet.pcm, count);
    const bool lost = atomic_exchange(&adc_overflow, false);
    bool voice_start = false;
#if !FRIDAY_RAM_CAPTURE_TEST
    const unsigned frame_start = sample_clock;
    sample_clock += count;
    unsigned endpoint = 0;
    const bool detected = wakeword_take_hit(&endpoint);
    const bool listen = calibrated && !lost && !active && !atomic_load(&busy) &&
                        !atomic_load(&capture_error) && atomic_load(&socket_up) && network_connected();
    if (!listen) history_count = 0;
    const unsigned back = frame_start - endpoint;
    voice_start = detected && listen && history_count && back <= history_count;
    wakeword_monitor_audio(packet.pcm, count, listen, lost, frame_start);
    if (listen && !voice_start) remember_audio(packet.pcm, count, frame_start);
#endif
#if FRIDAY_RAM_CAPTURE_TEST && FRIDAY_FIR_PAIR_TEST
    count = pcm_resample_pair(&fir_pair, &resampler, packet.pcm, count);
#elif FRIDAY_RAM_CAPTURE_TEST
    count = pcm_resample(&resampler, packet.pcm, count);
#endif
    const int64_t now = esp_timer_get_time();
    bool touch_valid = false;
    button_stable = touch_input_read(&touch_valid);
    const bool microphone_ready = calibrated;
    calibrated = calibrated && touch_valid;
    if (FRIDAY_RAM_CAPTURE_TEST && !ram_capacity && calibrated && atomic_load(&socket_up)) {
        allocate_clip();
        if (!ram_capacity) { atomic_store(&capture_error, true); return; }
    }
    if (active) {
        const char *reason = lost ? "ADC overflow" : !atomic_load(&voice_session) && !touch_valid ? "invalid touch input"
            : !microphone_ready ? "invalid microphone input"
            : !FRIDAY_WIFI_OFF_CAPTURE && !network_connected() ? "Wi-Fi lost"
            : !FRIDAY_WIFI_OFF_CAPTURE && !atomic_load(&socket_up) ? "server disconnected"
            : atomic_load(&capture_error) ? "send failed" : !FRIDAY_RAM_CAPTURE_TEST && now - started_at > 120000000 ? "time limit" : NULL;
        if (reason) fail_capture(reason);
    }
    const bool voice_active = active && atomic_load(&voice_session);
    const bool end_voice = voice_active && silence_elapsed;
    if (end_voice || (!voice_active && !button_stable && !voice_start)) {
        if (active) {
            ESP_LOGI(TAG, "%s: ending recording %u (%u samples)", end_voice ? "1.5 s silence" : "Button released", session, sample_total);
            packet.kind = FRIDAY_RAM_CAPTURE_TEST ? PACKET_RAM_CLIP : PACKET_END;
            packet.count = sample_total;
            if (FRIDAY_WIFI_OFF_CAPTURE) {
                atomic_store(&offline_samples, sample_total);
                xTaskNotifyGive(sender);
            } else if (xQueueSend(outgoing, &packet, 0) != pdTRUE) fail_capture("queue full at end");
            active = false;
            atomic_store(&capturing, false);
        }
        // Require a released button after boot, calibration or any failed attempt.
        if (calibrated && !atomic_load(&busy) && uxQueueMessagesWaiting(outgoing) == 0) {
            armed = true;
            atomic_store(&capture_error, false);
        }
        return;
    }
    if (!active && (armed || voice_start)) {
        armed = false;
        if (!(voice_start ? microphone_ready : calibrated) || !atomic_load(&socket_up) || !network_connected() || atomic_load(&busy)) {
            atomic_store(&capture_error, true);
            return;
        }
        ++session;
        atomic_store(&voice_session, voice_start && !button_stable);
        silence = (voice_silence_t){0};
        silence_elapsed = false;
        ESP_LOGI(TAG, "%s: starting recording %u", atomic_load(&voice_session) ? "Wake word" : "Button pressed", session);
        atomic_store(&clip_full, false);
        sample_total = 0;
        started_at = now;
        packet.session = session;
        packet.kind = PACKET_START;
        atomic_store(&busy, true);
        if (FRIDAY_WIFI_OFF_CAPTURE) {
            atomic_store(&radio_phase, RADIO_STOPPING);
            packet.kind = PACKET_PAUSE_RADIO;
            // Discard 300 ms of PCM after stop to clear the ADC pool and FIR history.
            discard_samples = PCM_RATE * 3 / 10;
            if (xQueueSend(outgoing, &packet, 0) != pdTRUE) {
                atomic_store(&radio_phase, RADIO_NORMAL);
                fail_capture("queue full at radio stop");
                return;
            }
        }
        if (!FRIDAY_RAM_CAPTURE_TEST && xQueueSend(outgoing, &packet, 0) != pdTRUE) { fail_capture("queue full at start"); return; }
#if !FRIDAY_RAM_CAPTURE_TEST
        if (atomic_load(&voice_session)) {
            packet_t replay = {.kind = PACKET_AUDIO, .session = session};
            for (unsigned left = back; left;) {
                unsigned pos = (frame_start - left) % HISTORY;
                unsigned n = left < PACKET_SAMPLES ? left : PACKET_SAMPLES;
                if (n > HISTORY - pos) n = HISTORY - pos;
                memcpy(replay.pcm, history + pos, n * sizeof(*history));
                replay.count = n;
                if (xQueueSend(outgoing, &replay, 0) != pdTRUE) { fail_capture("queue full at wake"); return; }
                sample_total += n;
                left -= n;
            }
        }
        history_count = 0;
#endif
        active = true;
        if (!FRIDAY_WIFI_OFF_CAPTURE) atomic_store(&capturing, true);
        packet.kind = PACKET_AUDIO;
    }
    if (active) {
        if (FRIDAY_WIFI_OFF_CAPTURE && !atomic_load(&capturing)) {
            if (atomic_load(&radio_phase) != RADIO_OFF) return;
            if (discard_samples) {
                discard_samples -= count < discard_samples ? count : discard_samples;
                return;
            }
            ESP_LOGI(TAG, "Clip %u: first PCM frame with radio off", session);
            atomic_store(&capturing, true);
        }
        if (FRIDAY_RAM_CAPTURE_TEST) {
            unsigned offset = 0;
            while (offset < count && sample_total < ram_capacity) {
                unsigned used = sample_total % PAGE_SAMPLES;
                unsigned take = PAGE_SAMPLES - used;
                if (take > count - offset) take = count - offset;
                memcpy(pages[sample_total / PAGE_SAMPLES] + used, packet.pcm + offset,
                       take * sizeof(int16_t));
                sample_total += take;
                offset += take;
            }
            if (sample_total == ram_capacity) atomic_store(&clip_full, true);
            return;
        }
        packet.session = session;
        packet.count = count;
        if (xQueueSend(outgoing, &packet, 0) != pdTRUE) fail_capture("network queue full");
        else {
            sample_total += count;
            if (atomic_load(&voice_session)) silence_elapsed = voice_silence_elapsed(&silence, loud, count);
        }
    }
}

const char *stream_status(void)
{
    if (!network_configured()) return "SETUP WIFI";
    if (FRIDAY_WIFI_OFF_CAPTURE && atomic_load(&radio_phase) != RADIO_NORMAL) {
        if (atomic_load(&capture_error)) return "RECORD ERROR";
        if (atomic_load(&capturing)) return atomic_load(&clip_full) ? "FULL" : "RECORD";
        return atomic_load(&radio_phase) == RADIO_RESTORING ? "SENDING" : "PREPARING";
    }
    if (!network_connected()) return "WIFI CONNECTING";
    if (!touch_input_ready()) return "TOUCH CAL";
    if (atomic_load(&capture_error)) return "RECORD ERROR";
    if (atomic_load(&capturing)) return atomic_load(&voice_session) ? "LISTENING" : atomic_load(&clip_full) ? "FULL" : "RECORD";
    if (!atomic_load(&socket_up)) return "NO SERVER";
    if (atomic_load(&busy)) return "SENDING";
    return "";
}

void stream_log_button(void)
{
    touch_input_log();
    ESP_LOGI(TAG, "Touch: pressed=%d armed=%d recording=%d wifi=%d server=%d error=%d",
             button_stable, armed, active, network_connected(), atomic_load(&socket_up),
             atomic_load(&capture_error));
}

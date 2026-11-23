if(EXISTS "${CMAKE_CURRENT_LIST_DIR}/../.local/wakeword_model.inc")
    set(wakeword_sources "wakeword.c" "wakeword_monitor.c")
else()
    set(wakeword_sources "wakeword_unconfigured.c")
endif()
idf_component_register(
    SRCS "main.c" "hello_scene.c" "audio_level.c" "microphone.c" "level_scene.c" "audio_pcm.c" "stream.c"
         ${wakeword_sources} "touch_input.c" "touch_gate.c" "ota.c"
    INCLUDE_DIRS "."
    PRIV_REQUIRES esp_lcd esp_adc esp_driver_spi esp_driver_gpio esp_system heap freertos log
                  esp_wifi esp_netif esp_event nvs_flash esp_timer esp_websocket_client
                  tcp_transport lwip esp_https_ota app_update
                  esp_driver_touch_sens
)
target_include_directories(${COMPONENT_LIB} PRIVATE "${CMAKE_CURRENT_LIST_DIR}/../.local")
option(FRIDAY_RAM_CAPTURE_TEST "Capture a PCM clip in available RAM before transmitting it" OFF)
target_compile_definitions(${COMPONENT_LIB} PRIVATE FRIDAY_RAM_CAPTURE_TEST=$<BOOL:${FRIDAY_RAM_CAPTURE_TEST}>)
option(FRIDAY_WIFI_OFF_CAPTURE "Stop the Wi-Fi radio while recording in RAM" OFF)
if(FRIDAY_WIFI_OFF_CAPTURE AND NOT FRIDAY_RAM_CAPTURE_TEST)
    message(FATAL_ERROR "Radio-off recording needs the RAM capture buffer")
endif()
target_compile_definitions(${COMPONENT_LIB} PRIVATE FRIDAY_WIFI_OFF_CAPTURE=$<BOOL:${FRIDAY_WIFI_OFF_CAPTURE}>)
option(FRIDAY_FIR_PAIR_TEST "Measure interference from resampling two ADC frames at a time" OFF)
target_compile_definitions(${COMPONENT_LIB} PRIVATE FRIDAY_FIR_PAIR_TEST=$<BOOL:${FRIDAY_FIR_PAIR_TEST}>)
option(FRIDAY_FIR_PAIR_CONTROL "Use identical diagnostic buffers but run the FIR on every frame" OFF)
target_compile_definitions(${COMPONENT_LIB} PRIVATE FRIDAY_FIR_PAIR_CONTROL=$<BOOL:${FRIDAY_FIR_PAIR_CONTROL}>)

# The continuous detector has a 10 ms per-frame budget on ESP32.
set_source_files_properties(wakeword.c PROPERTIES COMPILE_OPTIONS "-O2")

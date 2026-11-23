cmake_minimum_required(VERSION 3.16)

set(IDF_TARGET "esp32" CACHE STRING "Target chip")
include($ENV{IDF_PATH}/tools/cmake/project.cmake)
project(friday_firmware)

# Keep the per-installation HTTPS credentials across builds and OTA updates.
idf_build_get_property(idf_python PYTHON)
execute_process(COMMAND "${idf_python}" "${CMAKE_CURRENT_SOURCE_DIR}/scripts/ota.py" prepare
                RESULT_VARIABLE ota_setup_result)
if(NOT ota_setup_result EQUAL 0)
    message(FATAL_ERROR "Could not prepare local OTA credentials")
endif()
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS
             "${CMAKE_CURRENT_SOURCE_DIR}/scripts/ota.py"
             "${CMAKE_CURRENT_SOURCE_DIR}/.local/network_config.h")

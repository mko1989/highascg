# WO-596 — hshm GDExtension (HighAsCG shared-memory channel frames → Godot textures).
# Build: godot/extensions/hshm/build.sh  (wraps this; installs into Godot projects)
cmake_minimum_required(VERSION 3.17)
project(hshm LANGUAGES CXX)

# godot-cpp 10 is versioned independently of the engine; API 4.6 loads on 4.6.x and newer (4.7 box pin).
set(GODOTCPP_API_VERSION "4.6" CACHE STRING "Godot extension API version to target")
set(GODOTCPP_TAG "10.0.0-stable" CACHE STRING "godot-cpp git tag")
set(GODOTCPP_SOURCE_DIR "" CACHE PATH "Use an existing godot-cpp checkout instead of fetching")

if(GODOTCPP_SOURCE_DIR)
    add_subdirectory("${GODOTCPP_SOURCE_DIR}" godot-cpp)
else()
    include(FetchContent)
    FetchContent_Declare(godot-cpp
        GIT_REPOSITORY https://github.com/godotengine/godot-cpp.git
        GIT_TAG ${GODOTCPP_TAG}
        GIT_SHALLOW TRUE)
    FetchContent_MakeAvailable(godot-cpp)
endif()

add_library(hshm SHARED
    src/hshm_source.cpp
    src/hshm_source.h
    src/register_types.cpp)
target_include_directories(hshm PRIVATE src "${CMAKE_CURRENT_SOURCE_DIR}/../../../caspar/modules/shm")
target_link_libraries(hshm PRIVATE godot-cpp)

get_target_property(GODOTCPP_SUFFIX godot-cpp GODOTCPP_SUFFIX)
set(HSHM_OUT "${CMAKE_CURRENT_SOURCE_DIR}/bin")
set_target_properties(hshm PROPERTIES
    CXX_STANDARD 17
    CXX_EXTENSIONS OFF
    CXX_VISIBILITY_PRESET hidden
    POSITION_INDEPENDENT_CODE ON
    PREFIX "lib"
    OUTPUT_NAME "hshm${GODOTCPP_SUFFIX}"
    LIBRARY_OUTPUT_DIRECTORY "$<1:${HSHM_OUT}>"
    RUNTIME_OUTPUT_DIRECTORY "$<1:${HSHM_OUT}>")
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    target_link_libraries(hshm PRIVATE rt)
endif()

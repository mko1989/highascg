/* test_core.c — WO-745: a tiny libretro core for the RetroHost tests (tools/e2e/retro-source.sh), so no ROM is needed.
 * 160×144 XRGB8888 at 60 fps. The left half is green, red while JOYPAD A of port 0 is held; the right half is
 * (seed, seed, 255) where seed is the first byte of the loaded "game" file; 800 frames of a square wave per frame.
 * Build: cc -shared -fPIC -O2 -I<dir with libretro.h> test_core.c -o test_libretro.so */
#include "libretro.h"

#include <stdint.h>
#include <string.h>

#define W 160
#define H 144

static retro_environment_t        env;
static retro_video_refresh_t      video;
static retro_audio_sample_batch_t audio;
static retro_input_poll_t         poll_cb;
static retro_input_state_t        input;
static uint32_t                   fb[W * H];
static uint8_t                    seed;
static unsigned                   tick;

RETRO_API void     retro_set_environment(retro_environment_t cb) { env = cb; }
RETRO_API void     retro_set_video_refresh(retro_video_refresh_t cb) { video = cb; }
RETRO_API void     retro_set_audio_sample(retro_audio_sample_t cb) { (void)cb; }
RETRO_API void     retro_set_audio_sample_batch(retro_audio_sample_batch_t cb) { audio = cb; }
RETRO_API void     retro_set_input_poll(retro_input_poll_t cb) { poll_cb = cb; }
RETRO_API void     retro_set_input_state(retro_input_state_t cb) { input = cb; }
RETRO_API void     retro_set_controller_port_device(unsigned port, unsigned device) { (void)port, (void)device; }
RETRO_API unsigned retro_api_version(void) { return RETRO_API_VERSION; }
RETRO_API void     retro_init(void) { tick = 0; }
RETRO_API void     retro_deinit(void) {}
RETRO_API void     retro_reset(void) { tick = 0; }
RETRO_API unsigned retro_get_region(void) { return RETRO_REGION_NTSC; }
RETRO_API size_t   retro_serialize_size(void) { return 0; }
RETRO_API bool     retro_serialize(void* d, size_t s) { (void)d, (void)s; return false; }
RETRO_API bool     retro_unserialize(const void* d, size_t s) { (void)d, (void)s; return false; }
RETRO_API void     retro_cheat_reset(void) {}
RETRO_API void     retro_cheat_set(unsigned i, bool e, const char* c) { (void)i, (void)e, (void)c; }
RETRO_API void*    retro_get_memory_data(unsigned id) { (void)id; return NULL; }
RETRO_API size_t   retro_get_memory_size(unsigned id) { (void)id; return 0; }
RETRO_API void     retro_unload_game(void) {}
RETRO_API bool     retro_load_game_special(unsigned t, const struct retro_game_info* i, size_t n) { (void)t, (void)i, (void)n; return false; }

RETRO_API void retro_get_system_info(struct retro_system_info* info)
{
    memset(info, 0, sizeof(*info));
    info->library_name     = "HighAsCG test core";
    info->library_version  = "1";
    info->valid_extensions = "bin";
    info->need_fullpath    = false;
}

RETRO_API void retro_get_system_av_info(struct retro_system_av_info* av)
{
    memset(av, 0, sizeof(*av));
    av->geometry.base_width = av->geometry.max_width = W;
    av->geometry.base_height = av->geometry.max_height = H;
    av->geometry.aspect_ratio = (float)W / H;
    av->timing.fps            = 60.0;
    av->timing.sample_rate    = 48000.0;
}

RETRO_API bool retro_load_game(const struct retro_game_info* game)
{
    enum retro_pixel_format f = RETRO_PIXEL_FORMAT_XRGB8888;
    if (!game || !game->data || game->size < 1 || !env(RETRO_ENVIRONMENT_SET_PIXEL_FORMAT, &f))
        return false;
    seed = ((const uint8_t*)game->data)[0];
    return true;
}

RETRO_API void retro_run(void)
{
    static int16_t samples[800 * 2];
    poll_cb();
    const uint32_t left  = input(0, RETRO_DEVICE_JOYPAD, 0, RETRO_DEVICE_ID_JOYPAD_A) ? 0xFF0000u : 0x00FF00u;
    const uint32_t right = ((uint32_t)seed << 16) | ((uint32_t)seed << 8) | 0xFFu;
    for (int y = 0; y < H; ++y)
        for (int x = 0; x < W; ++x)
            fb[y * W + x] = x < W / 2 ? left : right;
    video(fb, W, H, W * sizeof(uint32_t));
    for (int i = 0; i < 800; ++i)
        samples[2 * i] = samples[2 * i + 1] = ((tick * 800 + i) / 55) % 2 ? 8000 : -8000;
    audio(samples, 800);
    ++tick;
}

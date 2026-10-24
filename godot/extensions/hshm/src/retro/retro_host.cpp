// retro_host.cpp — WO-745 (see retro_host.h).
#include "retro_host.h"

#include "libretro.h" // fetched into the build tree by ../../CMakeLists.txt (pinned RetroArch tag + SHA256)

#include <godot_cpp/core/class_db.hpp>

#include <cstdarg>
#include <cstdio>
#include <dlfcn.h>
#include <fstream>
#include <iterator>

namespace godot {

namespace {

struct Core // the core's entry points, resolved by name (libretro.h API v1)
{
    void (*init)();
    void (*deinit)();
    unsigned (*api_version)();
    void (*get_system_info)(retro_system_info*);
    void (*get_system_av_info)(retro_system_av_info*);
    void (*set_environment)(retro_environment_t);
    void (*set_video_refresh)(retro_video_refresh_t);
    void (*set_audio_sample)(retro_audio_sample_t);
    void (*set_audio_sample_batch)(retro_audio_sample_batch_t);
    void (*set_input_poll)(retro_input_poll_t);
    void (*set_input_state)(retro_input_state_t);
    bool (*load_game)(const retro_game_info*);
    void (*unload_game)();
    void (*run)();
};

Core       g_core{};
RetroHost* g_host = nullptr; // the one running core's host: libretro callbacks carry no user pointer

bool    cb_environment(unsigned cmd, void* data) { return g_host && g_host->on_environment(cmd, data); }
void    cb_video(const void* d, unsigned w, unsigned h, size_t pitch) { if (g_host) g_host->on_video(d, w, h, pitch); }
size_t  cb_audio_batch(const int16_t* d, size_t frames) { return g_host ? g_host->on_audio(d, frames) : frames; }
void    cb_audio_sample(int16_t l, int16_t r) { const int16_t s[2] = {l, r}; cb_audio_batch(s, 1); }
void    cb_input_poll() {}
int16_t cb_input_state(unsigned port, unsigned device, unsigned index, unsigned id)
{
    return g_host ? g_host->on_input(port, device, index, id) : 0;
}

void cb_log(enum retro_log_level level, const char* fmt, ...)
{
    if (level < RETRO_LOG_WARN)
        return; // debug / info chatter stays out of the operator's log
    std::va_list ap;
    va_start(ap, fmt);
    std::fputs("[retro] ", stderr);
    std::vfprintf(stderr, fmt, ap);
    va_end(ap);
}

template <typename F> bool resolve(void* lib, const char* name, F& out)
{
    out = reinterpret_cast<F>(dlsym(lib, name));
    return out != nullptr;
}

constexpr size_t AUDIO_MAX_FRAMES = 48000; // one second: an operator window that stops reading never grows forever

} // namespace

RetroHost::~RetroHost() { unload(); }

bool RetroHost::fail(const String& why)
{
    error_ = why;
    unload();
    return false;
}

bool RetroHost::load_core(const String& core_path, const String& system_dir, const String& save_dir)
{
    unload();
    if (g_host != nullptr)
        return fail("another core is running in this process");
    lib_ = dlopen(core_path.utf8().get_data(), RTLD_NOW | RTLD_LOCAL);
    if (!lib_)
        return fail(String("dlopen: ") + dlerror());
    Core c{};
    if (!resolve(lib_, "retro_init", c.init) || !resolve(lib_, "retro_deinit", c.deinit) ||
        !resolve(lib_, "retro_api_version", c.api_version) || !resolve(lib_, "retro_get_system_info", c.get_system_info) ||
        !resolve(lib_, "retro_get_system_av_info", c.get_system_av_info) ||
        !resolve(lib_, "retro_set_environment", c.set_environment) ||
        !resolve(lib_, "retro_set_video_refresh", c.set_video_refresh) ||
        !resolve(lib_, "retro_set_audio_sample", c.set_audio_sample) ||
        !resolve(lib_, "retro_set_audio_sample_batch", c.set_audio_sample_batch) ||
        !resolve(lib_, "retro_set_input_poll", c.set_input_poll) ||
        !resolve(lib_, "retro_set_input_state", c.set_input_state) || !resolve(lib_, "retro_load_game", c.load_game) ||
        !resolve(lib_, "retro_unload_game", c.unload_game) || !resolve(lib_, "retro_run", c.run))
        return fail("not a libretro core (missing retro_* entry points)");
    if (c.api_version() != RETRO_API_VERSION)
        return fail("libretro API version mismatch");
    g_core      = c;
    g_host      = this;
    system_dir_ = system_dir.utf8().get_data();
    save_dir_   = save_dir.utf8().get_data();
    g_core.set_environment(cb_environment); // before retro_init, as the API requires
    g_core.init();
    core_inited_ = true;
    g_core.set_video_refresh(cb_video);
    g_core.set_audio_sample(cb_audio_sample);
    g_core.set_audio_sample_batch(cb_audio_batch);
    g_core.set_input_poll(cb_input_poll);
    g_core.set_input_state(cb_input_state);
    retro_system_info si{};
    g_core.get_system_info(&si);
    core_name_ = String(si.library_name ? si.library_name : "?") + " " + String(si.library_version ? si.library_version : "");
    error_     = "";
    return true;
}

bool RetroHost::load_game(const String& game_path)
{
    if (!core_inited_)
        return fail("no core loaded");
    retro_system_info si{};
    g_core.get_system_info(&si);
    game_path_ = game_path.utf8().get_data();
    retro_game_info gi{};
    gi.path = game_path_.c_str();
    if (!si.need_fullpath) {
        std::ifstream f(game_path_, std::ios::binary);
        if (!f)
            return fail("cannot read " + game_path);
        game_data_.assign(std::istreambuf_iterator<char>(f), std::istreambuf_iterator<char>());
        gi.data = game_data_.data();
        gi.size = game_data_.size();
    }
    if (!g_core.load_game(&gi))
        return fail("the core refused " + game_path);
    game_loaded_ = true;
    retro_system_av_info av{};
    g_core.get_system_av_info(&av);
    width_       = static_cast<int>(av.geometry.base_width);
    height_      = static_cast<int>(av.geometry.base_height);
    fps_         = av.timing.fps > 0 ? av.timing.fps : 60.0;
    sample_rate_ = av.timing.sample_rate > 0 ? av.timing.sample_rate : 48000.0;
    frame_.resize(static_cast<int64_t>(width_) * height_ * 4);
    frame_.fill(0);
    return true;
}

void RetroHost::unload()
{
    if (g_host == this) {
        if (game_loaded_)
            g_core.unload_game();
        if (core_inited_)
            g_core.deinit();
        g_host = nullptr;
        g_core = Core{};
    }
    game_loaded_ = core_inited_ = false;
    if (lib_) {
        dlclose(lib_);
        lib_ = nullptr;
    }
    game_data_.clear();
}

void RetroHost::run_frame()
{
    if (game_loaded_ && g_host == this) {
        g_core.run();
        ++frames_;
    }
}

void RetroHost::set_button(int port, int id, bool pressed)
{
    if (port < 0 || port > 3 || id < 0 || id > 15)
        return;
    if (pressed)
        buttons_[port] |= static_cast<uint16_t>(1u << id);
    else
        buttons_[port] &= static_cast<uint16_t>(~(1u << id));
}

Ref<Image> RetroHost::get_image() const
{
    if (width_ <= 0 || height_ <= 0)
        return Ref<Image>();
    return Image::create_from_data(width_, height_, false, Image::FORMAT_RGBA8, frame_);
}

PackedVector2Array RetroHost::take_audio()
{
    PackedVector2Array out = audio_;
    audio_.clear();
    return out;
}

bool RetroHost::on_environment(unsigned cmd, void* data)
{
    switch (cmd) {
        case RETRO_ENVIRONMENT_GET_CAN_DUPE:
            *static_cast<bool*>(data) = true;
            return true;
        case RETRO_ENVIRONMENT_SET_PIXEL_FORMAT: {
            const auto f = *static_cast<const retro_pixel_format*>(data);
            if (f != RETRO_PIXEL_FORMAT_0RGB1555 && f != RETRO_PIXEL_FORMAT_XRGB8888 && f != RETRO_PIXEL_FORMAT_RGB565)
                return false;
            pixel_format_ = f;
            return true;
        }
        case RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY:
            *static_cast<const char**>(data) = system_dir_.c_str();
            return true;
        case RETRO_ENVIRONMENT_GET_SAVE_DIRECTORY:
            *static_cast<const char**>(data) = save_dir_.c_str();
            return true;
        case RETRO_ENVIRONMENT_GET_LOG_INTERFACE:
            static_cast<retro_log_callback*>(data)->log = cb_log;
            return true;
        case RETRO_ENVIRONMENT_GET_INPUT_BITMASKS:
            return true;
        case RETRO_ENVIRONMENT_SET_GEOMETRY: {
            const auto* g = static_cast<const retro_game_geometry*>(data);
            width_ = static_cast<int>(g->base_width), height_ = static_cast<int>(g->base_height);
            return true;
        }
        default:
            return false; // core options, rumble, cameras, HW rendering…: not offered
    }
}

// Any of libretro's three pixel formats → RGBA8, opaque. A NULL frame is a dupe: keep the last picture.
void RetroHost::on_video(const void* data, unsigned w, unsigned h, size_t pitch)
{
    if (!data || w == 0 || h == 0)
        return;
    width_  = static_cast<int>(w);
    height_ = static_cast<int>(h);
    frame_.resize(static_cast<int64_t>(w) * h * 4);
    uint8_t* d = frame_.ptrw();
    for (unsigned y = 0; y < h; ++y) {
        const uint8_t* row = static_cast<const uint8_t*>(data) + y * pitch;
        for (unsigned x = 0; x < w; ++x, d += 4) {
            if (pixel_format_ == RETRO_PIXEL_FORMAT_XRGB8888) {
                const uint8_t* p = row + x * 4; // little-endian 0x00RRGGBB = B, G, R, X in memory
                d[0] = p[2], d[1] = p[1], d[2] = p[0];
            } else {
                const uint16_t v = reinterpret_cast<const uint16_t*>(row)[x];
                if (pixel_format_ == RETRO_PIXEL_FORMAT_RGB565) {
                    d[0] = static_cast<uint8_t>(((v >> 11) & 31) * 255 / 31);
                    d[1] = static_cast<uint8_t>(((v >> 5) & 63) * 255 / 63);
                } else {
                    d[0] = static_cast<uint8_t>(((v >> 10) & 31) * 255 / 31);
                    d[1] = static_cast<uint8_t>(((v >> 5) & 31) * 255 / 31);
                }
                d[2] = static_cast<uint8_t>((v & 31) * 255 / 31);
            }
            d[3] = 255;
        }
    }
}

size_t RetroHost::on_audio(const int16_t* data, size_t frames)
{
    for (size_t i = 0; i < frames && static_cast<size_t>(audio_.size()) < AUDIO_MAX_FRAMES; ++i)
        audio_.push_back(Vector2(data[2 * i] / 32768.0f, data[2 * i + 1] / 32768.0f));
    return frames;
}

int16_t RetroHost::on_input(unsigned port, unsigned device, unsigned /*index*/, unsigned id) const
{
    if (port > 3 || (device & RETRO_DEVICE_MASK) != RETRO_DEVICE_JOYPAD)
        return 0;
    if (id == RETRO_DEVICE_ID_JOYPAD_MASK)
        return static_cast<int16_t>(buttons_[port]);
    return id < 16 && (buttons_[port] >> id) & 1 ? 1 : 0;
}

void RetroHost::_bind_methods()
{
    ClassDB::bind_method(D_METHOD("load_core", "core_path", "system_dir", "save_dir"), &RetroHost::load_core);
    ClassDB::bind_method(D_METHOD("load_game", "game_path"), &RetroHost::load_game);
    ClassDB::bind_method(D_METHOD("unload"), &RetroHost::unload);
    ClassDB::bind_method(D_METHOD("run_frame"), &RetroHost::run_frame);
    ClassDB::bind_method(D_METHOD("set_button", "port", "id", "pressed"), &RetroHost::set_button);
    ClassDB::bind_method(D_METHOD("get_frame"), &RetroHost::get_frame);
    ClassDB::bind_method(D_METHOD("get_image"), &RetroHost::get_image);
    ClassDB::bind_method(D_METHOD("take_audio"), &RetroHost::take_audio);
    ClassDB::bind_method(D_METHOD("get_width"), &RetroHost::get_width);
    ClassDB::bind_method(D_METHOD("get_height"), &RetroHost::get_height);
    ClassDB::bind_method(D_METHOD("get_fps"), &RetroHost::get_fps);
    ClassDB::bind_method(D_METHOD("get_sample_rate"), &RetroHost::get_sample_rate);
    ClassDB::bind_method(D_METHOD("get_frames"), &RetroHost::get_frames);
    ClassDB::bind_method(D_METHOD("get_core_name"), &RetroHost::get_core_name);
    ClassDB::bind_method(D_METHOD("get_error"), &RetroHost::get_error);
    ClassDB::bind_method(D_METHOD("is_running"), &RetroHost::is_running);
}

} // namespace godot

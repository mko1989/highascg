// retro_host.h — WO-745 (WO-738 §9): a minimal libretro frontend for Godot. RetroHost dlopens a libretro core
// (*_libretro.so), loads a game, runs it one frame per run_frame() and hands back the picture (RGBA8) and the sound
// (stereo floats); the operator's buttons go in with set_button(). godot/retro/ is the window around it, and its frames
// leave through HshmSink (WO-743) as a Live-tab source (WO-744).
// libretro's callbacks are plain C functions, so one RetroHost runs a core at a time (load_core refuses a second).
// Its own library (libretrohost); removing it is this folder plus its block in ../../CMakeLists.txt (WO-745).
#pragma once

#include <godot_cpp/classes/image.hpp>
#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/packed_vector2_array.hpp>
#include <godot_cpp/variant/string.hpp>

#include <cstdint>
#include <string>
#include <vector>

namespace godot {

class RetroHost : public RefCounted
{
    GDCLASS(RetroHost, RefCounted)

  public:
    RetroHost() = default;
    ~RetroHost() override;

    bool load_core(const String& core_path, const String& system_dir, const String& save_dir);
    bool load_game(const String& game_path);
    void unload();
    void run_frame();
    void set_button(int port, int id, bool pressed);

    PackedByteArray     get_frame() const { return frame_; } // RGBA8, get_width() × get_height(), opaque
    Ref<Image>          get_image() const;
    PackedVector2Array  take_audio(); // stereo frames produced since the last call
    int                 get_width() const { return width_; }
    int                 get_height() const { return height_; }
    double              get_fps() const { return fps_; }
    double              get_sample_rate() const { return sample_rate_; }
    int64_t             get_frames() const { return static_cast<int64_t>(frames_); }
    String              get_core_name() const { return core_name_; }
    String              get_error() const { return error_; }
    bool                is_running() const { return game_loaded_; }

    // libretro callbacks (static trampolines in retro_host.cpp call these on the active host)
    bool    on_environment(unsigned cmd, void* data);
    void    on_video(const void* data, unsigned w, unsigned h, size_t pitch);
    size_t  on_audio(const int16_t* data, size_t frames);
    int16_t on_input(unsigned port, unsigned device, unsigned index, unsigned id) const;

  protected:
    static void _bind_methods();

  private:
    bool fail(const String& why);

    void*                lib_ = nullptr;
    bool                 core_inited_ = false;
    bool                 game_loaded_ = false;
    int                  pixel_format_ = 0; // RETRO_PIXEL_FORMAT_0RGB1555 until the core says otherwise
    std::string          system_dir_;
    std::string          save_dir_;
    std::vector<uint8_t> game_data_; // the game, for cores that read it from memory (must outlive the run)
    std::string          game_path_;
    PackedByteArray      frame_;
    PackedVector2Array   audio_;
    uint16_t             buttons_[4] = {0, 0, 0, 0};
    int                  width_ = 0;
    int                  height_ = 0;
    double               fps_ = 60.0;
    double               sample_rate_ = 48000.0;
    uint64_t             frames_ = 0;
    String               core_name_;
    String               error_;
};

} // namespace godot

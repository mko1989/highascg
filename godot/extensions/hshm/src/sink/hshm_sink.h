// hshm_sink.h — WO-743 (WO-738 step 2): Godot-facing WRITER for HighAsCG shm frames (ABI: caspar/modules/shm/hshm_abi.h).
// The reverse of HshmSource: Godot pixels (an Image or raw RGBA8) are converted to BGRA8 premultiplied and published
// into /dev/shm/highascg-<name>, where Caspar's shm producer (WO-742: PLAY <ch>-<layer> SHM NAME <name>) plays them.
// Its own library (libhshm_sink) on purpose: the live HshmSource library is never rebuilt for it, and removing it is
// this folder plus its block in ../../CMakeLists.txt (WO-743 "How to remove").
#pragma once

#include "hshm_writer.h"

#include <godot_cpp/classes/image.hpp>
#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/string.hpp>

#include <cstdint>
#include <vector>

namespace godot {

class HshmSink : public RefCounted
{
    GDCLASS(HshmSink, RefCounted)

  public:
    HshmSink() = default;
    ~HshmSink() override;

    bool open(const String& name, int width, int height, int fps);
    void close();
    bool publish_rgba8(const PackedByteArray& rgba, bool straight_alpha);
    bool publish_image(const Ref<Image>& image, bool straight_alpha);

    bool    is_open() const { return open_; }
    String  get_name() const { return name_; }
    String  get_error() const { return error_; }
    int     get_width() const { return static_cast<int>(writer_.width()); }
    int     get_height() const { return static_cast<int>(writer_.height()); }
    int64_t get_published() const { return static_cast<int64_t>(writer_.published()); }

  protected:
    static void _bind_methods();

  private:
    hshm::writer         writer_;
    std::vector<uint8_t> bgra_; // conversion buffer, one frame
    String               name_;
    String               error_;
    bool                 open_ = false;
};

} // namespace godot

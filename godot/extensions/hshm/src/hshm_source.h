// hshm_source.h — WO-596: Godot-facing reader for HighAsCG shm frames (ABI: caspar/modules/shm/hshm_abi.h).
// One HshmSource per surface. poll() runs on the main thread and copies the newest stable frame
// (mmap → back buffer, one memcpy); upload_to(rid) runs on the render thread and hands the front
// buffer to RenderingDevice::texture_update. A mutex makes the swap/upload safe under either thread model.
#pragma once

#include "hshm_reader.h"

#include <godot_cpp/classes/ref_counted.hpp>
#include <godot_cpp/variant/packed_byte_array.hpp>
#include <godot_cpp/variant/rid.hpp>
#include <godot_cpp/variant/string.hpp>

#include <cstdint>
#include <mutex>
#include <string>

namespace godot {

class HshmSource : public RefCounted
{
    GDCLASS(HshmSource, RefCounted)

  public:
    HshmSource()  = default;
    ~HshmSource() override;

    bool open(const String& path);
    void close();
    bool poll();
    void upload_to(const RID& texture);
    PackedByteArray get_frame() const; // diagnostics only — holding the result forces copy-on-write

    String get_path() const { return path_; }
    int    get_width() const { return static_cast<int>(width_); }
    int    get_height() const { return static_cast<int>(height_); }
    double get_fps() const { return fps_; }
    int64_t get_frame_number() const { return static_cast<int64_t>(frame_number_); }
    int64_t get_frames() const { return static_cast<int64_t>(frames_); }
    int64_t get_gaps() const { return static_cast<int64_t>(gaps_); }
    int64_t get_lapped() const { return static_cast<int64_t>(lapped_); }
    int64_t get_reopens() const { return static_cast<int64_t>(reopens_); }
    int64_t get_writer_dropped() const;
    double  get_latency_ms() const { return latency_ms_; }
    double  get_read_ms() const { return read_ms_; }
    double  get_upload_ms() const { return upload_ms_; }
    bool    is_signal_lost() const { return signal_lost_; }
    bool    has_new_upload() const { return pending_upload_; }

  protected:
    static void _bind_methods();

  private:
    bool try_open();

    hshm::reader    reader_;
    String          path_;
    std::string     path_utf8_;
    PackedByteArray buffers_[2];
    int             front_         = 0; // buffer last completed by poll(); upload_to reads it
    bool            pending_upload_ = false;
    std::mutex      mutex_;

    uint32_t width_  = 0;
    uint32_t height_ = 0;
    double   fps_    = 0.0;

    uint64_t frame_number_ = 0;
    uint64_t frames_       = 0;
    uint64_t gaps_         = 0;
    uint64_t lapped_       = 0;
    uint64_t reopens_      = 0;
    uint64_t last_seq_     = 0;
    double   latency_ms_   = 0.0;
    double   read_ms_      = 0.0;
    double   upload_ms_    = 0.0;
    bool     signal_lost_  = true;

    uint64_t last_new_frame_ms_ = 0;
    uint64_t next_open_ms_      = 0;
    uint64_t next_replace_check_ms_ = 0;
};

} // namespace godot

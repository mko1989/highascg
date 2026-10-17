/*
 * hshm_reader.h — header-only reader for the HighAsCG shm frame ABI (WO-594 / WO-596).
 * No Godot or CasparCG dependencies: used by tools/hshm-probe, tests, and (WO-596) the Godot
 * GDExtension, which wraps it and uploads the copied frame into a Texture2DRD.
 */
#pragma once

#include "hshm_abi.h"

#include <cerrno>
#include <cstdint>
#include <cstring>
#include <fcntl.h>
#include <string>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

namespace hshm {

struct frame_info
{
    uint64_t frame_seq           = 0; // writer publish counter (gap detection)
    uint64_t frame_number        = 0; // producer frame number
    uint64_t publish_ns          = 0; // writer CLOCK_MONOTONIC
    uint64_t publish_realtime_ns = 0; // writer CLOCK_REALTIME
};

enum class poll_result { no_segment, no_new_frame, new_frame, lapped, geometry_changed };

class reader
{
  public:
    reader()                         = default;
    reader(const reader&)            = delete;
    reader& operator=(const reader&) = delete;
    ~reader() { close(); }

    /* path: "/dev/shm/highascg-opgui" on Linux, or any file written by open_path(). */
    bool open(const std::string& path)
    {
        close();
        path_ = path;
        fd_   = ::open(path.c_str(), O_RDONLY);
        if (fd_ < 0)
            return false;
        struct stat st {};
        if (::fstat(fd_, &st) != 0 || static_cast<size_t>(st.st_size) < HSHM_HEADER_SIZE) {
            close();
            return false;
        }
        size_  = static_cast<size_t>(st.st_size);
        inode_ = static_cast<uint64_t>(st.st_ino);
        void* p = ::mmap(nullptr, size_, PROT_READ, MAP_SHARED, fd_, 0);
        if (p == MAP_FAILED) {
            close();
            return false;
        }
        base_ = static_cast<const uint8_t*>(p);
        const auto* h = hdr();
        __atomic_thread_fence(__ATOMIC_ACQUIRE);
        if (std::memcmp(h->magic, HSHM_MAGIC, HSHM_MAGIC_LEN) != 0 || h->abi_version != HSHM_ABI_VERSION ||
            h->pixel_format != HSHM_PIXEL_FORMAT_BGRA8_PREMULT || h->slot_count != HSHM_SLOTS ||
            hshm_segment_size(h->stride, h->height) > size_) {
            close();
            return false;
        }
        width_      = h->width;
        height_     = h->height;
        stride_     = h->stride;
        generation_ = h->generation;
        last_latest_ = 0;
        return true;
    }

    bool is_open() const { return base_ != nullptr; }

    /* Copy the newest stable frame into dst (width*height*4 bytes, tightly packed) if there is one.
     * after_copy: test hook run between the copy and the seqlock re-check (forces a lap in tests). */
    poll_result poll(uint8_t* dst, frame_info* info, void (*after_copy)(void*) = nullptr, void* hook_ctx = nullptr)
    {
        if (!base_)
            return poll_result::no_segment;
        const auto* h = hdr();
        if (std::memcmp(h->magic, HSHM_MAGIC, HSHM_MAGIC_LEN) != 0)
            return poll_result::no_new_frame; // writer is re-initialising
        if (h->generation != generation_ || h->width != width_ || h->height != height_)
            return poll_result::geometry_changed;
        const uint64_t latest = hshm_load_acquire(&h->latest);
        if (latest == 0 || latest == last_latest_)
            return poll_result::no_new_frame;
        const uint64_t n    = latest >> 8;
        const uint32_t slot = static_cast<uint32_t>(latest & 0xff);
        if (slot >= HSHM_SLOTS)
            return poll_result::no_new_frame;
        const auto* sh = reinterpret_cast<const hshm_slot_header*>(base_ + h->slot_offset[slot]);
        if (hshm_load_acquire(&sh->seq) != 2 * n)
            return poll_result::lapped;
        const uint8_t* src = base_ + h->slot_offset[slot] + HSHM_SLOT_HEADER_SIZE;
        const size_t   row = static_cast<size_t>(width_) * 4;
        if (stride_ == row) {
            std::memcpy(dst, src, row * height_);
        } else {
            for (uint32_t y = 0; y < height_; ++y)
                std::memcpy(dst + y * row, src + static_cast<size_t>(y) * stride_, row);
        }
        frame_info fi;
        fi.frame_seq           = n;
        fi.frame_number        = sh->frame_number;
        fi.publish_ns          = sh->publish_ns;
        fi.publish_realtime_ns = sh->publish_realtime_ns;
        if (after_copy)
            after_copy(hook_ctx);
        __atomic_thread_fence(__ATOMIC_ACQUIRE);
        if (hshm_load_acquire(&sh->seq) != 2 * n)
            return poll_result::lapped; // torn: writer reused the slot while we copied
        last_latest_ = latest;
        if (info)
            *info = fi;
        return poll_result::new_frame;
    }

    /* True when the segment file was replaced (Caspar restart → new inode). */
    bool replaced() const
    {
        struct stat st {};
        return ::stat(path_.c_str(), &st) != 0 || static_cast<uint64_t>(st.st_ino) != inode_;
    }

    uint64_t dropped_by_writer() const { return base_ ? __atomic_load_n(&hdr()->dropped, __ATOMIC_RELAXED) : 0; }
    uint32_t width() const { return width_; }
    uint32_t height() const { return height_; }
    uint32_t fps_num() const { return base_ ? hdr()->fps_num : 0; }
    uint32_t fps_den() const { return base_ ? hdr()->fps_den : 1; }
    size_t   frame_bytes() const { return static_cast<size_t>(width_) * height_ * 4; }

    void close()
    {
        if (base_) {
            ::munmap(const_cast<uint8_t*>(base_), size_);
            base_ = nullptr;
        }
        if (fd_ >= 0) {
            ::close(fd_);
            fd_ = -1;
        }
    }

  private:
    const hshm_header* hdr() const { return reinterpret_cast<const hshm_header*>(base_); }

    const uint8_t* base_        = nullptr;
    size_t         size_        = 0;
    int            fd_          = -1;
    std::string    path_;
    uint64_t       inode_       = 0;
    uint32_t       width_       = 0;
    uint32_t       height_      = 0;
    uint32_t       stride_      = 0;
    uint64_t       generation_  = 0;
    uint64_t       last_latest_ = 0;
};

} // namespace hshm

/*
 * hshm_writer.h — header-only writer for the HighAsCG shm frame ABI (WO-594).
 * No CasparCG dependencies: used by consumer/shm_consumer.cpp and by tests/hshm_seqlock_test.cpp.
 * POSIX only (Linux in production; macOS for the file-backed tests).
 */
#pragma once

#include "hshm_abi.h"

#include <cerrno>
#include <cstdint>
#include <cstring>
#include <ctime>
#include <fcntl.h>
#include <stdexcept>
#include <string>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>

namespace hshm {

inline uint64_t now_ns(clockid_t clock)
{
    timespec ts{};
    clock_gettime(clock, &ts);
    return static_cast<uint64_t>(ts.tv_sec) * 1000000000ull + static_cast<uint64_t>(ts.tv_nsec);
}

class writer
{
  public:
    writer()                         = default;
    writer(const writer&)            = delete;
    writer& operator=(const writer&) = delete;
    ~writer() { close(); }

    /* POSIX shm object `/highascg-<name>` (→ /dev/shm/highascg-<name> on Linux). */
    void open_shm(const std::string& name, uint32_t w, uint32_t h, uint32_t fps_num, uint32_t fps_den, uint32_t ch)
    {
        const std::string obj = std::string(HSHM_SEGMENT_PREFIX) + name;
        int               fd  = ::shm_open(obj.c_str(), O_CREAT | O_RDWR, 0600);
        if (fd < 0)
            throw std::runtime_error("hshm: shm_open " + obj + ": " + std::strerror(errno));
        attach(fd, obj, true, w, h, fps_num, fps_den, ch);
    }

    /* Regular file (tests, macOS — which has no /dev/shm). */
    void open_path(const std::string& path, uint32_t w, uint32_t h, uint32_t fps_num, uint32_t fps_den, uint32_t ch)
    {
        int fd = ::open(path.c_str(), O_CREAT | O_RDWR, 0600);
        if (fd < 0)
            throw std::runtime_error("hshm: open " + path + ": " + std::strerror(errno));
        attach(fd, path, false, w, h, fps_num, fps_den, ch);
    }

    /* Copy one frame (rows of src_stride bytes, BGRA8) and publish it. Never blocks on readers. */
    void publish(const uint8_t* src, size_t src_stride, uint64_t frame_number)
    {
        if (!base_)
            return;
        const uint64_t n    = ++frame_seq_;
        const uint32_t slot = pick_slot();
        auto*          sh   = slot_header(slot);
        uint8_t*       dst  = slot_pixels(slot);

        hshm_store_release(&sh->seq, 2 * n - 1);
        const size_t row = static_cast<size_t>(width_) * 4;
        if (src_stride == row) {
            std::memcpy(dst, src, row * height_);
        } else {
            for (uint32_t y = 0; y < height_; ++y)
                std::memcpy(dst + static_cast<size_t>(y) * row, src + static_cast<size_t>(y) * src_stride, row);
        }
        sh->publish_ns          = now_ns(CLOCK_MONOTONIC);
        sh->publish_realtime_ns = now_ns(CLOCK_REALTIME);
        sh->frame_number        = frame_number;
        hshm_store_release(&sh->seq, 2 * n);

        hshm_store_release(&hdr()->latest, (n << 8) | slot);
        hshm_store_relaxed(&hdr()->heartbeat_ns, sh->publish_ns);
        hshm_store_relaxed(&hdr()->published, n);
        prev_slot_ = last_slot_;
        last_slot_ = static_cast<int>(slot);
    }

    void note_dropped(uint64_t count = 1)
    {
        if (base_ && count)
            __atomic_add_fetch(&hdr()->dropped, count, __ATOMIC_RELAXED);
    }

    uint64_t published() const { return frame_seq_; }
    uint64_t dropped() const { return base_ ? __atomic_load_n(&hdr()->dropped, __ATOMIC_RELAXED) : 0; }
    uint32_t width() const { return width_; }
    uint32_t height() const { return height_; }
    const std::string& object_name() const { return object_; }

    void close()
    {
        if (base_) {
            ::munmap(base_, size_);
            base_ = nullptr;
        }
        if (fd_ >= 0) {
            ::close(fd_);
            fd_ = -1;
        }
        if (!object_.empty()) {
            if (is_shm_)
                ::shm_unlink(object_.c_str());
            else
                ::unlink(object_.c_str());
            object_.clear();
        }
    }

  private:
    hshm_header*      hdr() const { return reinterpret_cast<hshm_header*>(base_); }
    hshm_slot_header* slot_header(uint32_t s) const
    {
        return reinterpret_cast<hshm_slot_header*>(base_ + hdr()->slot_offset[s]);
    }
    uint8_t* slot_pixels(uint32_t s) const { return base_ + hdr()->slot_offset[s] + HSHM_SLOT_HEADER_SIZE; }

    uint32_t pick_slot() const
    {
        for (uint32_t s = 0; s < HSHM_SLOTS; ++s)
            if (static_cast<int>(s) != last_slot_ && static_cast<int>(s) != prev_slot_)
                return s;
        return 0;
    }

    void attach(int fd, const std::string& obj, bool is_shm, uint32_t w, uint32_t h, uint32_t fps_num,
                uint32_t fps_den, uint32_t ch)
    {
        close();
        fd_     = fd;
        object_ = obj;
        is_shm_ = is_shm;
        width_  = w;
        height_ = h;

        const uint32_t stride = w * 4;
        size_                 = static_cast<size_t>(hshm_segment_size(stride, h));

        // Reuse an existing segment's generation so readers see a bump, not a reset to 1.
        uint64_t    previous_generation = 0;
        struct stat st {};
        if (::fstat(fd_, &st) == 0 && static_cast<size_t>(st.st_size) >= sizeof(hshm_header)) {
            hshm_header old{};
            if (::pread(fd_, &old, sizeof(old), 0) == static_cast<ssize_t>(sizeof(old)) &&
                std::memcmp(old.magic, HSHM_MAGIC, HSHM_MAGIC_LEN) == 0)
                previous_generation = old.generation;
        }
        if (::ftruncate(fd_, static_cast<off_t>(size_)) != 0)
            throw std::runtime_error("hshm: ftruncate " + obj + ": " + std::strerror(errno));
        void* p = ::mmap(nullptr, size_, PROT_READ | PROT_WRITE, MAP_SHARED, fd_, 0);
        if (p == MAP_FAILED)
            throw std::runtime_error("hshm: mmap " + obj + ": " + std::strerror(errno));
        base_ = static_cast<uint8_t*>(p);

        auto* hd = hdr();
        hshm_store_release(&hd->latest, 0); // readers treat the segment as empty while we rewrite it
        std::memset(hd->magic, 0, HSHM_MAGIC_LEN); // …and as invalid until the magic is written back last
        __atomic_thread_fence(__ATOMIC_RELEASE);
        std::memset(base_ + sizeof(hshm_header), 0, HSHM_HEADER_SIZE - sizeof(hshm_header));
        hd->abi_version  = HSHM_ABI_VERSION;
        hd->header_size  = HSHM_HEADER_SIZE;
        hd->width        = w;
        hd->height       = h;
        hd->stride       = stride;
        hd->pixel_format = HSHM_PIXEL_FORMAT_BGRA8_PREMULT;
        hd->fps_num      = fps_num;
        hd->fps_den      = fps_den;
        hd->slot_count   = HSHM_SLOTS;
        hd->channel      = ch;
        hd->slot_size    = hshm_slot_size(stride, h);
        for (uint32_t s = 0; s < HSHM_SLOTS; ++s) {
            hd->slot_offset[s] = HSHM_HEADER_SIZE + s * hd->slot_size;
            std::memset(base_ + hd->slot_offset[s], 0, sizeof(hshm_slot_header));
        }
        hd->producer_pid = static_cast<uint64_t>(::getpid());
        hd->dropped      = 0;
        hd->published    = 0;
        hd->heartbeat_ns = now_ns(CLOCK_MONOTONIC);
        hd->generation   = previous_generation + 1;
        std::memcpy(hd->magic, HSHM_MAGIC, HSHM_MAGIC_LEN); // magic last: a half-initialised header never validates
        __atomic_thread_fence(__ATOMIC_RELEASE);
        frame_seq_ = 0;
        last_slot_ = -1;
        prev_slot_ = -1;
    }

    uint8_t*    base_ = nullptr;
    size_t      size_ = 0;
    int         fd_   = -1;
    std::string object_;
    bool        is_shm_    = false;
    uint32_t    width_     = 0;
    uint32_t    height_    = 0;
    uint64_t    frame_seq_ = 0;
    int         last_slot_ = -1;
    int         prev_slot_ = -1;
};

} // namespace hshm

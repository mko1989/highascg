// hshm_sink.cpp — WO-743 (see hshm_sink.h).
#include "hshm_sink.h"

#include <godot_cpp/core/class_db.hpp>

#include <exception>

namespace godot {

HshmSink::~HshmSink() { close(); }

// A plain segment name (no '/', '\', '.'), the same rule as Caspar's PLAY ... SHM NAME, so it stays in /dev/shm.
bool HshmSink::open(const String& name, int width, int height, int fps)
{
    close();
    if (name.is_empty() || name.contains("/") || name.contains("\\") || name.contains(".")) {
        error_ = "a plain segment name is required";
        return false;
    }
    if (width <= 0 || height <= 0 || width > 8192 || height > 8192 || fps <= 0) {
        error_ = "bad geometry";
        return false;
    }
    try {
        writer_.open_shm(std::string(name.utf8().get_data()), static_cast<uint32_t>(width),
                         static_cast<uint32_t>(height), static_cast<uint32_t>(fps), 1, 0);
    } catch (const std::exception& e) {
        error_ = String(e.what());
        return false;
    }
    bgra_.assign(static_cast<size_t>(width) * height * 4, 0);
    name_  = name;
    error_ = "";
    open_  = true;
    return true;
}

void HshmSink::close() // unlinks the segment: a reader sees the writer gone and holds its last frame
{
    writer_.close();
    open_ = false;
}

// RGBA8 rows (Godot's FORMAT_RGBA8) → BGRA8 premultiplied (the ring's only format). Godot viewports and images carry
// straight alpha; pass straight_alpha = false only for pixels that are premultiplied already.
bool HshmSink::publish_rgba8(const PackedByteArray& rgba, bool straight_alpha)
{
    if (!open_ || static_cast<size_t>(rgba.size()) != bgra_.size())
        return false;
    const uint8_t* s = rgba.ptr();
    uint8_t*       d = bgra_.data();
    for (size_t i = 0, n = bgra_.size(); i < n; i += 4) {
        const uint32_t a = s[i + 3];
        if (straight_alpha && a != 255) {
            d[i]     = static_cast<uint8_t>((s[i + 2] * a + 127) / 255);
            d[i + 1] = static_cast<uint8_t>((s[i + 1] * a + 127) / 255);
            d[i + 2] = static_cast<uint8_t>((s[i] * a + 127) / 255);
        } else {
            d[i] = s[i + 2], d[i + 1] = s[i + 1], d[i + 2] = s[i];
        }
        d[i + 3] = static_cast<uint8_t>(a);
    }
    writer_.publish(bgra_.data(), static_cast<size_t>(writer_.width()) * 4, writer_.published() + 1);
    return true;
}

bool HshmSink::publish_image(const Ref<Image>& image, bool straight_alpha)
{
    if (!open_ || image.is_null() || image->get_width() != get_width() || image->get_height() != get_height())
        return false;
    if (image->get_format() == Image::FORMAT_RGBA8)
        return publish_rgba8(image->get_data(), straight_alpha);
    Ref<Image> copy = image->duplicate();
    copy->convert(Image::FORMAT_RGBA8);
    return publish_rgba8(copy->get_data(), straight_alpha);
}

void HshmSink::_bind_methods()
{
    ClassDB::bind_method(D_METHOD("open", "name", "width", "height", "fps"), &HshmSink::open);
    ClassDB::bind_method(D_METHOD("close"), &HshmSink::close);
    ClassDB::bind_method(D_METHOD("publish_rgba8", "rgba", "straight_alpha"), &HshmSink::publish_rgba8, DEFVAL(true));
    ClassDB::bind_method(D_METHOD("publish_image", "image", "straight_alpha"), &HshmSink::publish_image, DEFVAL(true));
    ClassDB::bind_method(D_METHOD("is_open"), &HshmSink::is_open);
    ClassDB::bind_method(D_METHOD("get_name"), &HshmSink::get_name);
    ClassDB::bind_method(D_METHOD("get_error"), &HshmSink::get_error);
    ClassDB::bind_method(D_METHOD("get_width"), &HshmSink::get_width);
    ClassDB::bind_method(D_METHOD("get_height"), &HshmSink::get_height);
    ClassDB::bind_method(D_METHOD("get_published"), &HshmSink::get_published);
}

} // namespace godot

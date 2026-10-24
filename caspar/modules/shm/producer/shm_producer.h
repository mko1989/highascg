#pragma once

#include <common/memory.h>

#include <core/fwd.h>

#include <string>
#include <vector>

namespace caspar { namespace shm {

// WO-742: PLAY <ch>-<layer> SHM NAME <name> — a HASCGSHM ring written by another local process, as a layer.
spl::shared_ptr<core::frame_producer> create_producer(const core::frame_producer_dependencies& dependencies,
                                                      const std::vector<std::wstring>&         params);

}} // namespace caspar::shm

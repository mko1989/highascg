#include "shm.h"

#include "consumer/shm_consumer.h"

#include <core/consumer/frame_consumer_registry.h>

namespace caspar { namespace shm {

void init(const core::module_dependencies& dependencies)
{
    dependencies.consumer_registry->register_consumer_factory(L"Shared Memory Consumer", create_consumer);
    dependencies.consumer_registry->register_preconfigured_consumer_factory(L"shm", create_preconfigured_consumer);
}

}} // namespace caspar::shm

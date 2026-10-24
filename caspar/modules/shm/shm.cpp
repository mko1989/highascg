#include "shm.h"

#include "consumer/shm_consumer.h"
#include "producer/shm_producer.h" // WO-742

#include <core/consumer/frame_consumer_registry.h>
#include <core/producer/frame_producer_registry.h>

namespace caspar { namespace shm {

void init(const core::module_dependencies& dependencies)
{
    dependencies.consumer_registry->register_consumer_factory(L"Shared Memory Consumer", create_consumer);
    dependencies.consumer_registry->register_preconfigured_consumer_factory(L"shm", create_preconfigured_consumer);
    dependencies.producer_registry->register_producer_factory(L"Shared Memory Producer", create_producer); // WO-742
}

}} // namespace caspar::shm

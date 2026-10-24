cmake_minimum_required (VERSION 3.28)
project (shm)

# WO-594 — HighAsCG shared-memory frame consumer; WO-742 — the producer (PLAY … SHM NAME <name>). Linux only (shm_open / CLOCK_MONOTONIC).
set(SOURCES
		consumer/shm_consumer.cpp
		consumer/shm_consumer.h
		producer/shm_producer.cpp
		producer/shm_producer.h

		hshm_abi.h
		hshm_writer.h
		hshm_reader.h

		shm.cpp
		shm.h
)

casparcg_add_module_project(shm
	SOURCES ${SOURCES}
	INIT_FUNCTION "shm::init"
)
target_include_directories(shm PRIVATE ..)

set_target_properties(shm PROPERTIES FOLDER modules)
source_group(sources\\consumer consumer/*)
source_group(sources\\producer producer/*)
source_group(sources ./*)

target_link_libraries(shm PRIVATE rt)

// register_types.cpp — WO-596 hshm GDExtension entry point.
#include "hshm_source.h"

#include <gdextension_interface.h>
#include <godot_cpp/core/class_db.hpp>
#include <godot_cpp/core/defs.hpp>
#include <godot_cpp/godot.hpp>

using namespace godot;

static void initialize_hshm_module(ModuleInitializationLevel p_level)
{
    if (p_level != MODULE_INITIALIZATION_LEVEL_SCENE)
        return;
    GDREGISTER_CLASS(HshmSource);
}

static void uninitialize_hshm_module(ModuleInitializationLevel p_level) { (void)p_level; }

extern "C" {
GDExtensionBool GDE_EXPORT hshm_library_init(GDExtensionInterfaceGetProcAddress p_get_proc_address,
                                             GDExtensionClassLibraryPtr          p_library,
                                             GDExtensionInitialization*          r_initialization)
{
    godot::GDExtensionBinding::InitObject init_obj(p_get_proc_address, p_library, r_initialization);
    init_obj.register_initializer(initialize_hshm_module);
    init_obj.register_terminator(uninitialize_hshm_module);
    init_obj.set_minimum_library_initialization_level(MODULE_INITIALIZATION_LEVEL_SCENE);
    return init_obj.init();
}
}

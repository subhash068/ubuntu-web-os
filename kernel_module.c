#include <linux/init.h>
#include <linux/module.h>
#include <linux/kernel.h>

// Kernel Module Metadata
MODULE_LICENSE("GPL");
MODULE_AUTHOR("Ubuntu Web OS Dev");
MODULE_DESCRIPTION("A foundational Linux Kernel Module for Web OS");
MODULE_VERSION("1.0");

// Initialization function: Called when the module is loaded (insmod)
static int __init webos_module_init(void) {
    // printk logs directly to the kernel ring buffer (viewable with dmesg)
    printk(KERN_INFO "Ubuntu Web OS: Kernel Module Loaded Successfully!\n");
    printk(KERN_INFO "Ubuntu Web OS: Ready to intercept system calls or manage hardware.\n");
    
    return 0; // Return 0 indicates successful loading
}

// Cleanup function: Called when the module is removed (rmmod)
static void __exit webos_module_exit(void) {
    printk(KERN_INFO "Ubuntu Web OS: Kernel Module Unloaded and memory freed.\n");
}

// Register initialization and cleanup macros
module_init(webos_module_init);
module_exit(webos_module_exit);

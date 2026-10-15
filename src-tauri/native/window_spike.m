// Debug-only AX adapter. AX handles are created, used and released on one worker.
#import <AppKit/AppKit.h>
#import <ApplicationServices/ApplicationServices.h>

typedef struct { double x, y, width, height; } GSPFrame;

int gsp_frontmost(void) {
    NSRunningApplication *app = NSWorkspace.sharedWorkspace.frontmostApplication;
    return app.activationPolicy == NSApplicationActivationPolicyRegular && app.processIdentifier != getpid()
        ? app.processIdentifier : 0;
}
int gsp_areas(GSPFrame *areas, int capacity) {
    NSArray<NSScreen *> *screens = NSScreen.screens;
    if (screens.count > capacity || screens.count == 0) return 0;
    double top = screens.firstObject.frame.origin.y + screens.firstObject.frame.size.height;
    for (NSUInteger i = 0; i < screens.count; i++) {
        NSRect r = screens[i].visibleFrame;
        areas[i] = (GSPFrame){r.origin.x, top - NSMaxY(r), r.size.width, r.size.height};
    }
    return (int)screens.count;
}
bool gsp_buttons(void) {
    for (int i = 0; i < 32; i++) if (CGEventSourceButtonState(kCGEventSourceStateCombinedSessionState, i)) return true;
    return false;
}
bool gsp_trusted(void) { return AXIsProcessTrusted(); }
static id attribute(AXUIElementRef element, CFStringRef name) {
    CFTypeRef value = NULL;
    if (AXUIElementCopyAttributeValue(element, name, &value) != kAXErrorSuccess) {
        if (value) CFRelease(value);
        return nil;
    }
    return CFBridgingRelease(value);
}
static bool is_false(AXUIElementRef window, CFStringRef name) {
    id value = attribute(window, name);
    return value && CFGetTypeID((__bridge CFTypeRef)value) == CFBooleanGetTypeID() && ![value boolValue];
}
void *gsp_select(int pid) {
    @autoreleasepool {
        AXUIElementRef app = AXUIElementCreateApplication(pid);
        AXUIElementSetMessagingTimeout(app, 0.1);
        id value = attribute(app, kAXFocusedWindowAttribute);
        CFRelease(app);
        if (!value || CFGetTypeID((__bridge CFTypeRef)value) != AXUIElementGetTypeID()) return NULL;
        AXUIElementRef window = (__bridge AXUIElementRef)value;
        pid_t owner = 0;
        if (AXUIElementGetPid(window, &owner) != kAXErrorSuccess || owner != pid) return NULL;
        if (AXUIElementSetMessagingTimeout(window, 0.1) != kAXErrorSuccess) return NULL;
        if (![attribute(window, kAXSubroleAttribute) isEqual:(__bridge NSString *)kAXStandardWindowSubrole]
            || !is_false(window, kAXMinimizedAttribute) || !is_false(window, CFSTR("AXFullScreen"))
            || !is_false(window, kAXModalAttribute)) return NULL;
        id children = attribute(window, kAXChildrenAttribute);
        if (![children isKindOfClass:NSArray.class] || [children count] > 64) return NULL;
        for (id child in children) {
            if (CFGetTypeID((__bridge CFTypeRef)child) != AXUIElementGetTypeID()) return NULL;
            AXUIElementRef element = (__bridge AXUIElementRef)child;
            if (AXUIElementSetMessagingTimeout(element, 0.1) != kAXErrorSuccess) return NULL;
            id role = attribute(element, kAXRoleAttribute);
            if (!role || [role isEqual:(__bridge NSString *)kAXSheetRole]) return NULL;
        }
        for (NSString *name in @[(id)kAXPositionAttribute, (id)kAXSizeAttribute]) {
            Boolean writable = false;
            if (AXUIElementIsAttributeSettable(window, (__bridge CFStringRef)name, &writable) != kAXErrorSuccess || !writable) return NULL;
        }
        return (void *)CFRetain(window);
    }
}
void gsp_release(void *window) { CFRelease(window); }
int gsp_frame(void *window, GSPFrame *frame) {
    @autoreleasepool {
        id p = attribute(window, kAXPositionAttribute), s = attribute(window, kAXSizeAttribute);
        if (!p || !s || CFGetTypeID((__bridge CFTypeRef)p) != AXValueGetTypeID()
            || CFGetTypeID((__bridge CFTypeRef)s) != AXValueGetTypeID()) return -1;
        CGPoint point; CGSize size;
        if (!AXValueGetValue((__bridge AXValueRef)p, kAXValueCGPointType, &point)
            || !AXValueGetValue((__bridge AXValueRef)s, kAXValueCGSizeType, &size)) return -1;
        *frame = (GSPFrame){point.x, point.y, size.width, size.height};
        return 0;
    }
}
int gsp_write(void *window, GSPFrame frame, bool resize) {
    CGPoint point = CGPointMake(frame.x, frame.y);
    CGSize size = CGSizeMake(frame.width, frame.height);
    AXValueRef value = resize ? AXValueCreate(kAXValueCGSizeType, &size) : AXValueCreate(kAXValueCGPointType, &point);
    if (!value) return -1;
    AXError error = AXUIElementSetAttributeValue(window, resize ? kAXSizeAttribute : kAXPositionAttribute, value);
    CFRelease(value);
    return error;
}
void gsp_observe(void (*cancel)(void)) {
    for (NSNotificationName name in @[NSWorkspaceWillSleepNotification, NSWorkspaceSessionDidResignActiveNotification]) {
        [NSWorkspace.sharedWorkspace.notificationCenter addObserverForName:name object:nil queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *note) { cancel(); }];
    }
}

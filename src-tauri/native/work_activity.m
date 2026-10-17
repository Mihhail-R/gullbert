#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#import <CoreGraphics/CoreGraphics.h>
#include "work_activity.h"

// Only aggregate activity and window rectangles leave this adapter. Never read
// window titles, text, pixels, or individual keys, and never request a grant.
bool gullbert_work_sample(GullbertWorkSample *sample) {
    @autoreleasepool {
        if (IsSecureEventInputEnabled()) {
            return false;
        }

        NSRunningApplication *frontmost = NSWorkspace.sharedWorkspace.frontmostApplication;
        pid_t ownProcess = NSProcessInfo.processInfo.processIdentifier;

        if (frontmost == nil || frontmost.processIdentifier == ownProcess) {
            return false;
        }

        NSArray *windows = CFBridgingRelease(CGWindowListCopyWindowInfo(
            kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements,
            kCGNullWindowID
        ));

        for (NSDictionary *window in windows) {
            if ([window[(id)kCGWindowOwnerPID] intValue] != frontmost.processIdentifier) {
                continue;
            }

            if ([window[(id)kCGWindowLayer] intValue] != 0) {
                continue;
            }

            if ([window[(id)kCGWindowAlpha] doubleValue] <= 0) {
                continue;
            }

            CGRect bounds;
            CFDictionaryRef rectangle = (__bridge CFDictionaryRef)window[(id)kCGWindowBounds];

            if (rectangle == NULL || !CGRectMakeWithDictionaryRepresentation(rectangle, &bounds)) {
                continue;
            }

            if (bounds.size.width < 200 || bounds.size.height < 120) {
                continue;
            }

            sample->window_id = [window[(id)kCGWindowNumber] unsignedIntValue];
            sample->x = bounds.origin.x;
            sample->y = bounds.origin.y;
            sample->width = bounds.size.width;
            sample->height = bounds.size.height;
            sample->key_down_count = CGEventSourceCounterForEventType(
                kCGEventSourceStateCombinedSessionState,
                kCGEventKeyDown
            );
            sample->idle_seconds = CGEventSourceSecondsSinceLastEventType(
                kCGEventSourceStateCombinedSessionState,
                kCGEventKeyDown
            );
            return true;
        }

        return false;
    }
}

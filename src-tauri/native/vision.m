// Local, transient OCR of a small visible screen region. No files or network.
#import <AppKit/AppKit.h>
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <Vision/Vision.h>
#import <CoreGraphics/CoreGraphics.h>
#include <stdint.h>
#include <math.h>
#include <stdatomic.h>
static atomic_bool captureBusy = false;

typedef struct {
  int32_t status; // 1 unsupported, 2 permission, 3 no text, 4 found, 5 capture failed
  uint32_t display;
  double x, y, height;
  uint32_t glyph;
} GullbertVisionResult;

int32_t gullbert_vision_access(int32_t prompt) {
  if (@available(macOS 14.0, *)) {
    if (prompt && !CGPreflightScreenCaptureAccess()) { CGRequestScreenCaptureAccess(); }
    return CGPreflightScreenCaptureAccess() ? 3 : 1;
  }
  return 0;
}

static GullbertVisionResult gullbert_recognize(CGImageRef image, CGRect crop, CGPoint pointer) {
  GullbertVisionResult result = { .status = 3 };
  @autoreleasepool {
    VNRecognizeTextRequest *request = [[VNRecognizeTextRequest alloc] init];
    request.recognitionLevel = VNRequestTextRecognitionLevelAccurate;
    request.usesLanguageCorrection = NO;
    request.minimumTextHeight = 0.018;
    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCGImage:image options:@{}];
    NSError *error = nil;
    if (![handler performRequests:@[request] error:&error]) { result.status = 5; return result; }
    double best = INFINITY;
    for (VNRecognizedTextObservation *observation in request.results) {
      VNRecognizedText *text = [[observation topCandidates:1] firstObject];
      if (!text || text.confidence < 0.3) { continue; }
      // Word boxes are more accurate than individual glyph boxes. Only the last
      // printable ASCII glyph leaves this function; recognized strings die here.
      __block GullbertVisionResult candidate = result;
      __block double closest = best;
      [text.string enumerateSubstringsInRange:NSMakeRange(0, text.string.length)
        options:NSStringEnumerationByWords usingBlock:^(NSString *word, NSRange range, NSRange enclosing, BOOL *stop) {
          (void)word; (void)enclosing; (void)stop;
          VNRectangleObservation *box = [text boundingBoxForRange:range error:nil];
          if (!box || range.length == 0) { return; }
          CGRect normalized = box.boundingBox;
          CGRect rect = CGRectMake(crop.origin.x + normalized.origin.x * crop.size.width,
            crop.origin.y + (1 - CGRectGetMaxY(normalized)) * crop.size.height,
            normalized.size.width * crop.size.width, normalized.size.height * crop.size.height);
          if (rect.size.height < 6 || rect.size.height > 100) { return; }
          double dx = fmax(rect.origin.x - pointer.x, fmax(0, pointer.x - CGRectGetMaxX(rect)));
          double dy = fmax(rect.origin.y - pointer.y, fmax(0, pointer.y - CGRectGetMaxY(rect)));
          double distance = hypot(dx, dy);
          if (distance >= closest) { return; }
          closest = distance;
          unichar glyph = [text.string characterAtIndex:NSMaxRange(range) - 1];
          if (glyph < 33 || glyph > 126) { glyph = 'o'; }
          candidate = (GullbertVisionResult){ .status = 4, .x = CGRectGetMaxX(rect) - fmin(8, rect.size.width / 2),
            .y = rect.origin.y, .height = rect.size.height, .glyph = glyph };
        }];
      if (closest < best) { best = closest; result = candidate; }
    }
  }
  return result;
}

GullbertVisionResult gullbert_vision_read(void) {
  GullbertVisionResult unavailable = { .status = 1 };
  if (@available(macOS 14.0, *)) {
    if (!CGPreflightScreenCaptureAccess()) { unavailable.status = 2; return unavailable; }
    if (atomic_exchange(&captureBusy, true)) { unavailable.status = 5; return unavailable; }
    @autoreleasepool {
      CGEventRef event = CGEventCreate(NULL);
      if (!event) { atomic_store(&captureBusy, false); unavailable.status = 5; return unavailable; }
      CGPoint pointer = CGEventGetLocation(event);
      CFRelease(event);
      dispatch_semaphore_t done = dispatch_semaphore_create(0);
      __block GullbertVisionResult result = { .status = 5 };
      [SCShareableContent getShareableContentExcludingDesktopWindows:YES onScreenWindowsOnly:YES
        completionHandler:^(SCShareableContent *content, NSError *error) {
          SCDisplay *display = nil;
          for (SCDisplay *item in content.displays) {
            if (CGRectContainsPoint(item.frame, pointer)) { display = item; break; }
          }
          if (error || !display) { atomic_store(&captureBusy, false); dispatch_semaphore_signal(done); return; }
          NSMutableArray<SCRunningApplication *> *excluded = [NSMutableArray array];
          for (SCRunningApplication *app in content.applications) {
            if (app.processID == getpid()) { [excluded addObject:app]; }
          }
          CGRect crop = CGRectIntersection(display.frame, CGRectMake(pointer.x - 320, pointer.y - 180, 640, 360));
          SCContentFilter *filter = [[SCContentFilter alloc] initWithDisplay:display excludingApplications:excluded exceptingWindows:@[]];
          SCStreamConfiguration *configuration = [[SCStreamConfiguration alloc] init];
          configuration.sourceRect = CGRectOffset(crop, -display.frame.origin.x, -display.frame.origin.y);
          configuration.width = (size_t)ceil(crop.size.width * 2);
          configuration.height = (size_t)ceil(crop.size.height * 2);
          configuration.showsCursor = NO;
          configuration.scalesToFit = YES;
          uint32_t displayID = display.displayID;
          [SCScreenshotManager captureImageWithFilter:filter configuration:configuration
            completionHandler:^(CGImageRef image, NSError *captureError) {
              if (captureError || !image) { atomic_store(&captureBusy, false); dispatch_semaphore_signal(done); return; }
              CGImageRetain(image);
              dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
                result = gullbert_recognize(image, crop, pointer);
                result.display = displayID;
                CGImageRelease(image);
                atomic_store(&captureBusy, false);
                dispatch_semaphore_signal(done);
              });
            }];
        }];
      if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 4 * NSEC_PER_SEC)) != 0) {
        // The copied blocks own their state until late callbacks finish. Never
        // return their partially-written result after a timeout.
        unavailable.status = 5;
        return unavailable;
      }
      return result;
    }
  }
  return unavailable;
}

#import "FirebaseBootstrapper.h"

@implementation FirebaseBootstrapper

+ (void)configureIfPossible {
  Class firAppClass = NSClassFromString(@"FIRApp");
  if (firAppClass == Nil) {
    NSLog(@"PickleTourLive: FIRApp class not found. Firebase Crashlytics disabled for this build.");
    return;
  }

  SEL defaultAppSelector = NSSelectorFromString(@"defaultApp");
  if ([firAppClass respondsToSelector:defaultAppSelector]) {
    IMP defaultAppImp = [firAppClass methodForSelector:defaultAppSelector];
    id (*defaultAppFn)(id, SEL) = (id (*)(id, SEL))defaultAppImp;
    if (defaultAppFn(firAppClass, defaultAppSelector) != nil) {
      return;
    }
  }

  NSString *configPath = [[NSBundle mainBundle] pathForResource:@"GoogleService-Info"
                                                         ofType:@"plist"];
  if (configPath.length == 0) {
    NSLog(@"PickleTourLive: GoogleService-Info.plist not found. Firebase Crashlytics disabled for this build.");
    return;
  }

  SEL configureSelector = NSSelectorFromString(@"configure");
  if ([firAppClass respondsToSelector:configureSelector]) {
    IMP configureImp = [firAppClass methodForSelector:configureSelector];
    void (*configureFn)(id, SEL) = (void (*)(id, SEL))configureImp;
    configureFn(firAppClass, configureSelector);
  } else {
    NSLog(@"PickleTourLive: FIRApp configure selector not found. Firebase Crashlytics disabled for this build.");
  }
}

@end

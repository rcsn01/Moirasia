#import <AppKit/AppKit.h>
#import <node_api.h>
#include <string>

struct BridgeHandle {
  NSBundle *bundle;
  id principal;
  NSViewController *controller;
  NSView *container;
};

static napi_value fail(napi_env env, NSString *message) {
  napi_throw_error(env, "MOIRASIA_NATIVE_VIEW", message.UTF8String);
  return nullptr;
}

static NSString *stringArg(napi_env env, napi_value value) {
  size_t size = 0;
  napi_get_value_string_utf8(env, value, nullptr, 0, &size);
  std::string result(size, '\0');
  napi_get_value_string_utf8(env, value, result.data(), size + 1, &size);
  return [NSString stringWithUTF8String:result.c_str()];
}

static BridgeHandle *externalArg(napi_env env, napi_value value) {
  void *data = nullptr;
  napi_get_value_external(env, value, &data);
  return static_cast<BridgeHandle *>(data);
}

static double numberArg(napi_env env, napi_value value) {
  double result = 0;
  napi_get_value_double(env, value, &result);
  return result;
}

static void detach(BridgeHandle *handle) {
  if (!handle || !handle->container) return;
  [handle->controller viewWillDisappear];
  [handle->container removeFromSuperview];
  [handle->controller viewDidDisappear];
  handle->container = nil;
}

static napi_value loadBundle(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 1) return fail(env, @"loadBundle expects a bundle path");
  [NSApplication sharedApplication];
  NSString *path = stringArg(env, args[0]);
  NSBundle *bundle = [NSBundle bundleWithPath:path];
  NSError *error = nil;
  if (!bundle || ![bundle loadAndReturnError:&error]) return fail(env, error.localizedDescription ?: @"Could not load native module bundle");
  Class principalClass = bundle.principalClass;
  if (!principalClass) return fail(env, @"Native module has no principal class");
  id principal = [[principalClass alloc] init];
  SEL make = NSSelectorFromString(@"makeViewController");
  if (![principal respondsToSelector:make]) return fail(env, @"Native module principal does not implement makeViewController");
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
  NSViewController *controller = [principal performSelector:make];
#pragma clang diagnostic pop
  if (![controller isKindOfClass:NSViewController.class]) return fail(env, @"Native module returned an invalid view controller");
  auto *handle = new BridgeHandle{bundle, principal, controller, nil};
  napi_value result; napi_create_external(env, handle, nullptr, nullptr, &result); return result;
}

static napi_value attachView(napi_env env, napi_callback_info info) {
  size_t argc = 6; napi_value args[6]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  if (argc != 6) return fail(env, @"attach expects handle, native view buffer, x, y, width, height");
  BridgeHandle *handle = externalArg(env, args[0]);
  void *buffer = nullptr; size_t length = 0;
  if (napi_get_buffer_info(env, args[1], &buffer, &length) != napi_ok || length < sizeof(void *)) return fail(env, @"Invalid Electron native view handle");
  NSView *root = (__bridge NSView *)(*reinterpret_cast<void **>(buffer));
  if (![root isKindOfClass:NSView.class]) return fail(env, @"Electron handle is not an NSView");
  detach(handle);
  double x = numberArg(env, args[2]), y = numberArg(env, args[3]), width = numberArg(env, args[4]), height = numberArg(env, args[5]);
  NSRect frame = NSMakeRect(x, root.isFlipped ? y : root.bounds.size.height - y - height, width, height);
  NSView *container = [[NSView alloc] initWithFrame:frame];
  container.autoresizesSubviews = YES;
  handle->controller.view.frame = container.bounds;
  handle->controller.view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
  [handle->controller viewWillAppear];
  [container addSubview:handle->controller.view];
  [root addSubview:container positioned:NSWindowAbove relativeTo:nil];
  [handle->controller viewDidAppear];
  handle->container = container;
  return nullptr;
}

static napi_value setBounds(napi_env env, napi_callback_info info) {
  size_t argc = 5; napi_value args[5]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  BridgeHandle *handle = externalArg(env, args[0]);
  if (!handle->container) return nullptr;
  NSView *root = handle->container.superview;
  double x = numberArg(env, args[1]), y = numberArg(env, args[2]), width = numberArg(env, args[3]), height = numberArg(env, args[4]);
  handle->container.frame = NSMakeRect(x, root.isFlipped ? y : root.bounds.size.height - y - height, width, height);
  return nullptr;
}

static napi_value detachView(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr); detach(externalArg(env, args[0])); return nullptr;
}

static napi_value focusView(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  BridgeHandle *handle = externalArg(env, args[0]);
  if (handle->container.window) [handle->container.window makeFirstResponder:handle->controller.view];
  return nullptr;
}

static napi_value disposeView(napi_env env, napi_callback_info info) {
  size_t argc = 1; napi_value args[1]; napi_get_cb_info(env, info, &argc, args, nullptr, nullptr);
  BridgeHandle *handle = externalArg(env, args[0]);
  detach(handle);
  SEL stop = NSSelectorFromString(@"stop");
  if ([handle->principal respondsToSelector:stop]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Warc-performSelector-leaks"
    [handle->principal performSelector:stop];
#pragma clang diagnostic pop
  }
  handle->controller = nil; handle->principal = nil; handle->bundle = nil; delete handle; return nullptr;
}

static napi_value initialize(napi_env env, napi_value exports) {
  napi_property_descriptor properties[] = {
    {"loadBundle", nullptr, loadBundle, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"attach", nullptr, attachView, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"setBounds", nullptr, setBounds, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"detach", nullptr, detachView, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"focus", nullptr, focusView, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"dispose", nullptr, disposeView, nullptr, nullptr, nullptr, napi_default, nullptr}
  };
  napi_define_properties(env, exports, sizeof(properties) / sizeof(properties[0]), properties); return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, initialize)

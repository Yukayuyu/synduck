// macOS desktop bridge, run by /usr/bin/osascript -l JavaScript.
// One JSON request on stdin, one JSON response on stdout. Only fixed error
// codes are printed: never window titles, typed text or host details.
ObjC.import('Foundation');
ObjC.import('AppKit');
ObjC.import('CoreGraphics');
ObjC.import('ApplicationServices');

function respond(value) {
  $.NSFileHandle.fileHandleWithStandardOutput.writeData(
    $(JSON.stringify(value)).dataUsingEncoding($.NSUTF8StringEncoding),
  );
}
function fail(code) {
  const error = new Error(code);
  error.bridgeCode = code;
  throw error;
}
// On-screen windows, front to back. Layer 0 is ordinary application windows.
function listWindows() {
  const info = $.CGWindowListCopyWindowInfo(1 | 16, 0);
  const windows = ObjC.deepUnwrap(ObjC.castRefToObject(info)) || [];
  return windows
    .filter(
      (w) =>
        w.kCGWindowLayer === 0 &&
        w.kCGWindowBounds &&
        w.kCGWindowBounds.Width >= 40 &&
        w.kCGWindowBounds.Height >= 40,
    )
    .map((w) => ({
      id: String(w.kCGWindowNumber),
      // The window name is only available with Screen Recording permission.
      title: [w.kCGWindowOwnerName, w.kCGWindowName]
        .filter((part) => typeof part === 'string' && part.length > 0)
        .join(' — ')
        .slice(0, 1000),
      process_id: Number(w.kCGWindowOwnerPID),
      bounds: {
        left: Math.round(w.kCGWindowBounds.X),
        top: Math.round(w.kCGWindowBounds.Y),
        width: Math.round(w.kCGWindowBounds.Width),
        height: Math.round(w.kCGWindowBounds.Height),
      },
    }))
    .filter((w) => w.title.length > 0);
}
function locate(request) {
  const found = listWindows().find((w) => w.id === String(request.window));
  if (!found) fail('window_missing');
  if (request.process_id && found.process_id !== request.process_id) fail('process_changed');
  return found;
}
function activate(processId) {
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(processId);
  if (app.isNil()) fail('window_missing');
  // NSApplicationActivateIgnoringOtherApps
  app.activateWithOptions(2);
  delay(0.25);
}
function post(event) {
  // kCGHIDEventTap
  $.CGEventPost(0, event);
  delay(0.02);
}
function mouse(type, point, clicks) {
  const event = $.CGEventCreateMouseEvent($(), type, point, 0);
  // kCGMouseEventClickState
  if (clicks) $.CGEventSetIntegerValueField(event, 1, clicks);
  post(event);
}
function key(code, command) {
  for (const down of [true, false]) {
    const event = $.CGEventCreateKeyboardEvent($(), code, down);
    // kCGEventFlagMaskCommand; an explicit 0 clears modifiers held by the user.
    $.CGEventSetFlags(event, command ? 0x100000 : 0);
    post(event);
  }
}
const keyCodes = {
  Enter: 36,
  Tab: 48,
  Escape: 53,
  Backspace: 51,
  Delete: 117,
  ArrowUp: 126,
  ArrowDown: 125,
  ArrowLeft: 123,
  ArrowRight: 124,
  A: 0,
  C: 8,
  V: 9,
  Z: 6,
  S: 1,
};

function run() {
  try {
    const input = $.NSString.alloc.initWithDataEncoding(
      $.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile,
      $.NSUTF8StringEncoding,
    ).js;
    const request = JSON.parse(input);
    if (request.operation === 'windows') {
      respond(listWindows().map(({ id, title, process_id }) => ({ id, title, process_id })));
      return;
    }
    let target = locate(request);
    if (request.operation === 'locate') {
      activate(target.process_id);
      target = locate(request);
      respond({
        window: { id: target.id, title: target.title, process_id: target.process_id },
        bounds: target.bounds,
      });
      return;
    }
    if (!$.AXIsProcessTrusted()) fail('accessibility_required');
    activate(target.process_id);
    const windows = listWindows();
    target = windows.find((w) => w.id === target.id);
    if (!target) fail('window_missing');
    for (const field of ['left', 'top', 'width', 'height'])
      if (target.bounds[field] !== request.bounds[field]) fail('geometry_changed');
    // Keyboard input goes to the frontmost window, so it must be the target.
    if (windows[0].id !== target.id) fail('not_frontmost');
    if (['click', 'double_click', 'scroll'].includes(request.operation)) {
      if (
        request.x < 0 ||
        request.y < 0 ||
        request.x >= request.image_width ||
        request.y >= request.image_height
      )
        fail('invalid_coordinates');
      const point = {
        x: target.bounds.left + Math.floor((request.x * target.bounds.width) / request.image_width),
        y:
          target.bounds.top + Math.floor((request.y * target.bounds.height) / request.image_height),
      };
      // kCGEventMouseMoved, kCGEventLeftMouseDown, kCGEventLeftMouseUp
      mouse(5, point, 0);
      if (request.operation === 'click') {
        mouse(1, point, 1);
        mouse(2, point, 1);
      } else if (request.operation === 'double_click') {
        mouse(1, point, 1);
        mouse(2, point, 1);
        mouse(1, point, 2);
        mouse(2, point, 2);
      } else {
        // kCGScrollEventUnitLine; positive scrolls up, as on Windows.
        post($.CGEventCreateScrollWheelEvent2($(), 1, 1, Math.trunc(request.delta) * 3, 0, 0));
      }
    } else if (request.operation === 'type_text') {
      // Paste through the clipboard so any Unicode text arrives intact, then
      // put the previous plain-text clipboard content back.
      const board = $.NSPasteboard.generalPasteboard;
      const previous = board.stringForType($.NSPasteboardTypeString);
      board.clearContents;
      board.setStringForType($(String(request.text)), $.NSPasteboardTypeString);
      delay(0.05);
      key(keyCodes.V, true);
      delay(0.25);
      board.clearContents;
      if (!previous.isNil()) board.setStringForType(previous, $.NSPasteboardTypeString);
    } else if (request.operation === 'key') {
      const name = String(request.key);
      // Windows-style Control shortcuts map to Command on macOS.
      const command = name.startsWith('Control+');
      const code = keyCodes[name.replace('Control+', '')];
      if (code === undefined) fail('unsupported_key');
      key(code, command);
    } else fail('unsupported_operation');
    respond({ ok: true });
  } catch (error) {
    respond({ error: error && error.bridgeCode ? error.bridgeCode : 'bridge_failed' });
  }
}

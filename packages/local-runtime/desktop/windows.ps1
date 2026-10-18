$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class CanvasDesktop {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a, uint b, bool attach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point p);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll", SetLastError=true)] public static extern uint SendInput(uint n, Input[] inputs, int size);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint Type; public Union Data; }
  [StructLayout(LayoutKind.Explicit)] public struct Union {
    [FieldOffset(0)] public Mouse Mouse;
    [FieldOffset(0)] public Keyboard Keyboard;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int X,Y; public uint MouseData,Flags,Time; public IntPtr Extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Keyboard { public ushort Key,Scan; public uint Flags,Time; public IntPtr Extra; }
  public static void SendMouse(uint flag, int data) {
    var i=new Input(); i.Type=0; i.Data.Mouse.Flags=flag; i.Data.Mouse.MouseData=unchecked((uint)data);
    if(SendInput(1,new[]{i},Marshal.SizeOf(typeof(Input)))!=1) throw new Exception("Input was blocked");
  }
  public static void Focus(IntPtr handle) {
    if(SetForegroundWindow(handle) && GetForegroundWindow()==handle) return;
    uint pid;
    uint foreground=GetWindowThreadProcessId(GetForegroundWindow(),out pid);
    uint current=GetCurrentThreadId();
    bool attached=foreground!=current && AttachThreadInput(current,foreground,true);
    try { SetForegroundWindow(handle); }
    finally { if(attached) AttachThreadInput(current,foreground,false); }
  }
  public static void SendKey(ushort key,bool up) {
    var i=new Input(); i.Type=1; i.Data.Keyboard.Key=key; i.Data.Keyboard.Flags=(up?2u:0u)|((key>=37 && key<=40 || key==46)?1u:0u);
    if(SendInput(1,new[]{i},Marshal.SizeOf(typeof(Input)))!=1) throw new Exception("Input was blocked");
  }
  public static void TypeText(string text) {
    foreach(char c in text) {
      var down=new Input(); down.Type=1; down.Data.Keyboard.Scan=c; down.Data.Keyboard.Flags=4;
      var up=down; up.Data.Keyboard.Flags=6;
      if(SendInput(2,new[]{down,up},Marshal.SizeOf(typeof(Input)))!=2) throw new Exception("Input was blocked");
    }
  }
}
'@
[CanvasDesktop]::SetProcessDPIAware() | Out-Null
function Window-Info([IntPtr] $handle) {
    $title = New-Object System.Text.StringBuilder 1000
    [CanvasDesktop]::GetWindowText($handle, $title, 1000) | Out-Null
    [uint32] $windowProcess = 0
    [CanvasDesktop]::GetWindowThreadProcessId($handle, [ref]$windowProcess) | Out-Null
    return @{ id = $handle.ToInt64().ToString(); title = $title.ToString(); process_id = $windowProcess }
}
try {
    # One newline-delimited JSON request: don't wait for pipe EOF on Windows.
    $request = [Console]::In.ReadLine() | ConvertFrom-Json
    if ($request.operation -eq 'windows') {
        $script:windows = New-Object System.Collections.Generic.List[Object]
        $callback = [CanvasDesktop+EnumProc] {
            param([IntPtr] $handle, [IntPtr] $unused)
            if ([CanvasDesktop]::IsWindowVisible($handle)) {
                $info = Window-Info $handle
                if ($info.title -and $script:windows.Count -lt 200) { $script:windows.Add($info) }
            }
            return $true
        }
        [CanvasDesktop]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
        [Console]::Write((ConvertTo-Json -InputObject @($script:windows.ToArray()) -Compress -Depth 8))
        exit 0
    }
    $handle = [IntPtr]::new([long]$request.window)
    if (-not [CanvasDesktop]::IsWindow($handle)) { throw 'Target window no longer exists' }
    $info = Window-Info $handle
    if ($request.process_id -and $info.process_id -ne $request.process_id) { throw 'Target process changed' }
    if ([CanvasDesktop]::IsIconic($handle)) { [CanvasDesktop]::ShowWindow($handle, 9) | Out-Null }
    [CanvasDesktop]::Focus($handle)
    Start-Sleep -Milliseconds 180
    if ([CanvasDesktop]::GetForegroundWindow() -ne $handle) { throw 'Cannot focus selected window; select it manually and retry' }
    $rectangle = New-Object CanvasDesktop+Rect
    [CanvasDesktop]::GetWindowRect($handle, [ref]$rectangle) | Out-Null
    $desktop = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $left = [Math]::Max($rectangle.Left, $desktop.Left)
    $top = [Math]::Max($rectangle.Top, $desktop.Top)
    $right = [Math]::Min($rectangle.Right, $desktop.Right)
    $bottom = [Math]::Min($rectangle.Bottom, $desktop.Bottom)
    $bounds = @{left=$left;top=$top;width=($right-$left);height=($bottom-$top)}
    if ($bounds.width -lt 1 -or $bounds.height -lt 1 -or $bounds.width*$bounds.height -gt 40000000) { throw 'Invalid visible window size' }
    if ($request.operation -eq 'capture') {
        $bitmap = New-Object System.Drawing.Bitmap $bounds.width, $bounds.height
        $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
        try { $graphics.CopyFromScreen($left, $top, 0, 0, $bitmap.Size) } finally { $graphics.Dispose() }
        $ratio = [Math]::Min(1.0, [Math]::Min(1280.0/$bounds.width, 1280.0/$bounds.height))
        $scaled = New-Object System.Drawing.Bitmap ([int]($bounds.width*$ratio)), ([int]($bounds.height*$ratio))
        $graphics = [System.Drawing.Graphics]::FromImage($scaled)
        try { $graphics.DrawImage($bitmap, 0, 0, $scaled.Width, $scaled.Height) } finally { $graphics.Dispose(); $bitmap.Dispose() }
        $stream = New-Object System.IO.MemoryStream
        try { $scaled.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png); $png=[Convert]::ToBase64String($stream.ToArray()) }
        finally { $stream.Dispose(); $scaled.Dispose() }
        [Console]::Write((@{png=$png;bounds=$bounds;window=(Window-Info $handle)} | ConvertTo-Json -Compress -Depth 8))
        exit 0
    }
    foreach ($field in @('left','top','width','height')) {
        if ($bounds[$field] -ne $request.bounds.$field) { throw 'Window geometry changed' }
    }
    if ($request.operation -in @('click','double_click','scroll')) {
        if ($request.x -lt 0 -or $request.y -lt 0 -or $request.x -ge $request.image_width -or $request.y -ge $request.image_height) { throw 'Invalid screenshot coordinates' }
        $x = $left + [int][Math]::Floor($request.x*$bounds.width/$request.image_width)
        $y = $top + [int][Math]::Floor($request.y*$bounds.height/$request.image_height)
        # Confirm the point belongs to the selected window rather than a transparent/overlaid window.
        $point = New-Object CanvasDesktop+Point
        $point.X = $x; $point.Y = $y
        if ([CanvasDesktop]::GetAncestor([CanvasDesktop]::WindowFromPoint($point), 2) -ne $handle) { throw 'Target point belongs to another window' }
        [CanvasDesktop]::SetCursorPos($x,$y) | Out-Null
    }
    switch ($request.operation) {
        'click' { [CanvasDesktop]::SendMouse(2,0); [CanvasDesktop]::SendMouse(4,0) }
        'double_click' {
            [CanvasDesktop]::SendMouse(2,0); [CanvasDesktop]::SendMouse(4,0)
            Start-Sleep -Milliseconds 60
            [CanvasDesktop]::SendMouse(2,0); [CanvasDesktop]::SendMouse(4,0)
        }
        'scroll' { [CanvasDesktop]::SendMouse(2048,[int]$request.delta*120) }
        'type_text' { [CanvasDesktop]::TypeText([string]$request.text) }
        'key' {
            $keys = @{Enter=13;Tab=9;Escape=27;Backspace=8;Delete=46;ArrowUp=38;ArrowDown=40;ArrowLeft=37;ArrowRight=39;A=65;C=67;V=86;Z=90;S=83}
            $name = [string]$request.key
            $control = $name.StartsWith('Control+')
            $single = $name.Replace('Control+','')
            if (-not $keys.ContainsKey($single)) { throw 'Unsupported key' }
            if ($control) { [CanvasDesktop]::SendKey(17,$false) }
            try { [CanvasDesktop]::SendKey($keys[$single],$false); [CanvasDesktop]::SendKey($keys[$single],$true) }
            finally { if ($control) { [CanvasDesktop]::SendKey(17,$true) } }
        }
        default { throw 'Unsupported desktop operation' }
    }
    [Console]::Write('{"ok":true}')
} catch {
    # Fixed error text: no raw C# stack, host data or script input is printed.
    [Console]::Write('{"error":"Window unavailable, focus/geometry changed, or input blocked"}')
    exit 1
}

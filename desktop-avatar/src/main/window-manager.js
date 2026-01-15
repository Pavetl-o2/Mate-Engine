/**
 * Window Manager - Cross-platform window detection
 *
 * Detects open windows and their positions for the avatar to interact with.
 * Supports Windows and macOS.
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const { screen } = require('electron');

const execAsync = promisify(exec);

class WindowManager {
  constructor() {
    this.windows = [];
    this.taskbarInfo = null;
    this.detectionInterval = null;
    this.detectionRate = 500; // ms between detections
    this.platform = process.platform;
  }

  /**
   * Start continuous window detection
   */
  startDetection() {
    this.detectWindows(); // Initial detection
    this.detectTaskbar(); // Detect taskbar once

    this.detectionInterval = setInterval(() => {
      this.detectWindows();
    }, this.detectionRate);

    console.log(`Window detection started (${this.platform})`);
  }

  /**
   * Stop window detection
   */
  stopDetection() {
    if (this.detectionInterval) {
      clearInterval(this.detectionInterval);
      this.detectionInterval = null;
    }
    console.log('Window detection stopped');
  }

  /**
   * Get current list of windows
   */
  getWindows() {
    return this.windows;
  }

  /**
   * Get taskbar information
   */
  getTaskbarInfo() {
    return this.taskbarInfo;
  }

  /**
   * Detect taskbar position and size
   */
  async detectTaskbar() {
    try {
      if (this.platform === 'win32') {
        await this.detectTaskbarWindows();
      } else if (this.platform === 'darwin') {
        await this.detectTaskbarMac();
      }
    } catch (error) {
      console.error('Error detecting taskbar:', error.message);
    }
  }

  /**
   * Detect taskbar on Windows
   */
  async detectTaskbarWindows() {
    const script = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class TaskbarInfo {
          [DllImport("user32.dll")]
          public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
          [DllImport("user32.dll")]
          public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
          [StructLayout(LayoutKind.Sequential)]
          public struct RECT {
            public int Left, Top, Right, Bottom;
          }
        }
"@
      $hwnd = [TaskbarInfo]::FindWindow("Shell_TrayWnd", $null)
      $rect = New-Object TaskbarInfo+RECT
      [TaskbarInfo]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
      "$($rect.Left),$($rect.Top),$($rect.Right),$($rect.Bottom)"
    `;

    try {
      const { stdout } = await execAsync(`powershell -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
        timeout: 5000
      });

      const [left, top, right, bottom] = stdout.trim().split(',').map(Number);
      const display = screen.getPrimaryDisplay();
      const screenHeight = display.bounds.height;

      // Determine taskbar position
      let position = 'bottom';
      if (top === 0 && bottom < screenHeight / 2) position = 'top';
      else if (left === 0 && right < display.bounds.width / 2) position = 'left';
      else if (left > display.bounds.width / 2) position = 'right';

      this.taskbarInfo = {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
        position
      };
    } catch (error) {
      // Fallback: assume bottom taskbar
      const display = screen.getPrimaryDisplay();
      this.taskbarInfo = {
        x: 0,
        y: display.workAreaSize.height,
        width: display.bounds.width,
        height: display.bounds.height - display.workAreaSize.height,
        position: 'bottom'
      };
    }
  }

  /**
   * Detect dock on macOS
   */
  async detectTaskbarMac() {
    try {
      // Get dock position using defaults
      const { stdout: positionOut } = await execAsync('defaults read com.apple.dock orientation', {
        timeout: 3000
      });
      const position = positionOut.trim() || 'bottom';

      const display = screen.getPrimaryDisplay();
      const workArea = display.workArea;
      const bounds = display.bounds;

      // Calculate dock dimensions based on position
      if (position === 'bottom') {
        this.taskbarInfo = {
          x: workArea.x,
          y: workArea.y + workArea.height,
          width: workArea.width,
          height: bounds.height - workArea.height - workArea.y,
          position: 'bottom'
        };
      } else if (position === 'left') {
        this.taskbarInfo = {
          x: 0,
          y: workArea.y,
          width: workArea.x,
          height: workArea.height,
          position: 'left'
        };
      } else if (position === 'right') {
        this.taskbarInfo = {
          x: workArea.x + workArea.width,
          y: workArea.y,
          width: bounds.width - workArea.width - workArea.x,
          height: workArea.height,
          position: 'right'
        };
      }
    } catch (error) {
      // Fallback
      const display = screen.getPrimaryDisplay();
      this.taskbarInfo = {
        x: 0,
        y: display.workAreaSize.height,
        width: display.bounds.width,
        height: 70,
        position: 'bottom'
      };
    }
  }

  /**
   * Detect all visible windows
   */
  async detectWindows() {
    try {
      if (this.platform === 'win32') {
        await this.detectWindowsWindows();
      } else if (this.platform === 'darwin') {
        await this.detectWindowsMac();
      } else {
        // Linux - basic support
        await this.detectWindowsLinux();
      }
    } catch (error) {
      console.error('Error detecting windows:', error.message);
    }
  }

  /**
   * Detect windows on Windows OS
   */
  async detectWindowsWindows() {
    const script = `
      Add-Type @"
        using System;
        using System.Text;
        using System.Collections.Generic;
        using System.Runtime.InteropServices;
        public class WinEnum {
          [DllImport("user32.dll")]
          public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
          [DllImport("user32.dll")]
          public static extern bool IsWindowVisible(IntPtr hWnd);
          [DllImport("user32.dll")]
          public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
          [DllImport("user32.dll", CharSet=CharSet.Auto)]
          public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
          [DllImport("user32.dll")]
          public static extern int GetWindowTextLength(IntPtr hWnd);
          [DllImport("user32.dll", CharSet=CharSet.Auto)]
          public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
          [DllImport("user32.dll")]
          public static extern bool IsIconic(IntPtr hWnd);
          public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
          [StructLayout(LayoutKind.Sequential)]
          public struct RECT { public int Left, Top, Right, Bottom; }
        }
"@
      $windows = @()
      $callback = {
        param([IntPtr]$hwnd, [IntPtr]$lparam)
        if ([WinEnum]::IsWindowVisible($hwnd) -and -not [WinEnum]::IsIconic($hwnd)) {
          $length = [WinEnum]::GetWindowTextLength($hwnd)
          if ($length -gt 0) {
            $title = New-Object System.Text.StringBuilder($length + 1)
            [WinEnum]::GetWindowText($hwnd, $title, $title.Capacity) | Out-Null
            $className = New-Object System.Text.StringBuilder(256)
            [WinEnum]::GetClassName($hwnd, $className, 256) | Out-Null
            $rect = New-Object WinEnum+RECT
            [WinEnum]::GetWindowRect($hwnd, [ref]$rect) | Out-Null
            $width = $rect.Right - $rect.Left
            $height = $rect.Bottom - $rect.Top
            if ($width -gt 100 -and $height -gt 50) {
              $cn = $className.ToString()
              if ($cn -ne "Shell_TrayWnd" -and $cn -ne "Progman" -and $cn -ne "WorkerW") {
                $script:windows += "$($rect.Left)|$($rect.Top)|$width|$height|$($title.ToString().Replace('|','-'))"
              }
            }
          }
        }
        return $true
      }
      [WinEnum]::EnumWindows($callback, [IntPtr]::Zero) | Out-Null
      $windows -join ";"
    `;

    try {
      const { stdout } = await execAsync(
        `powershell -Command "${script.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`,
        { timeout: 5000, maxBuffer: 1024 * 1024 }
      );

      this.windows = this.parseWindowsOutput(stdout.trim());
    } catch (error) {
      // Keep previous windows on error
      if (error.killed) {
        console.warn('Window detection timed out');
      }
    }
  }

  /**
   * Detect windows on macOS
   */
  async detectWindowsMac() {
    const script = `
      tell application "System Events"
        set windowList to ""
        repeat with proc in (every process whose visible is true)
          try
            set procName to name of proc
            repeat with w in (every window of proc)
              try
                set {x, y} to position of w
                set {width, height} to size of w
                set winName to name of w
                if width > 100 and height > 50 then
                  set windowList to windowList & x & "|" & y & "|" & width & "|" & height & "|" & winName & ";"
                end if
              end try
            end repeat
          end try
        end repeat
        return windowList
      end tell
    `;

    try {
      const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\"'\"'")}'`, {
        timeout: 5000
      });

      this.windows = this.parseWindowsOutput(stdout.trim());
    } catch (error) {
      // macOS might require accessibility permissions
      if (error.message.includes('not allowed')) {
        console.warn('Accessibility permissions required for window detection on macOS');
      }
    }
  }

  /**
   * Detect windows on Linux (basic X11 support)
   */
  async detectWindowsLinux() {
    try {
      const { stdout } = await execAsync(
        `wmctrl -l -G 2>/dev/null | awk '{print $3"|"$4"|"$5"|"$6"|"$8}'`,
        { timeout: 5000 }
      );

      this.windows = this.parseWindowsOutput(stdout.trim());
    } catch (error) {
      // wmctrl might not be installed
      console.warn('wmctrl not available for Linux window detection');
    }
  }

  /**
   * Parse window detection output into structured data
   */
  parseWindowsOutput(output) {
    if (!output) return [];

    return output
      .split(';')
      .filter(line => line.trim())
      .map(line => {
        const [x, y, width, height, title] = line.split('|');
        return {
          x: parseInt(x, 10) || 0,
          y: parseInt(y, 10) || 0,
          width: parseInt(width, 10) || 0,
          height: parseInt(height, 10) || 0,
          title: title || 'Unknown',
          // Calculate edges for sitting detection
          topEdge: parseInt(y, 10) || 0,
          bottomEdge: (parseInt(y, 10) || 0) + (parseInt(height, 10) || 0),
          leftEdge: parseInt(x, 10) || 0,
          rightEdge: (parseInt(x, 10) || 0) + (parseInt(width, 10) || 0)
        };
      })
      .filter(win => win.width > 0 && win.height > 0);
  }

  /**
   * Find windows near a specific point
   */
  findWindowsNearPoint(x, y, threshold = 50) {
    return this.windows.filter(win => {
      // Check if point is near the top edge of the window
      const nearTop = Math.abs(y - win.topEdge) <= threshold &&
                      x >= win.leftEdge &&
                      x <= win.rightEdge;
      return nearTop;
    });
  }

  /**
   * Find the best window to sit on at a given position
   */
  findBestWindowToSit(avatarX, avatarY, avatarHeight) {
    const avatarBottom = avatarY + avatarHeight;
    const threshold = 30; // pixels

    // Find windows where avatar's bottom is near the window's top
    const candidates = this.windows.filter(win => {
      const nearTop = Math.abs(avatarBottom - win.topEdge) <= threshold;
      const withinHorizontal = avatarX >= win.leftEdge - 50 &&
                               avatarX <= win.rightEdge + 50;
      return nearTop && withinHorizontal;
    });

    // Sort by closest match
    candidates.sort((a, b) => {
      const distA = Math.abs(avatarBottom - a.topEdge);
      const distB = Math.abs(avatarBottom - b.topEdge);
      return distA - distB;
    });

    return candidates[0] || null;
  }

  /**
   * Check if position is near taskbar
   */
  isNearTaskbar(x, y, threshold = 50) {
    if (!this.taskbarInfo) return false;

    const tb = this.taskbarInfo;
    const nearX = x >= tb.x - threshold && x <= tb.x + tb.width + threshold;
    const nearY = y >= tb.y - threshold && y <= tb.y + tb.height + threshold;

    return nearX && nearY;
  }
}

module.exports = WindowManager;

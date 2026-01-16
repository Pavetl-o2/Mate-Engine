/**
 * Tray Manager - System tray icon and menu
 *
 * Provides system tray functionality for controlling the avatar
 */

const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');

class TrayManager {
  constructor(mainWindow, appInstance) {
    this.mainWindow = mainWindow;
    this.app = appInstance;
    this.tray = null;
    this.isAlwaysOnTop = true;

    this.createTray();
  }

  /**
   * Create the system tray icon and menu
   */
  createTray() {
    // Create a simple icon (you can replace with custom icon)
    const iconPath = this.getIconPath();
    let icon;

    try {
      icon = nativeImage.createFromPath(iconPath);
      if (icon.isEmpty()) {
        icon = this.createDefaultIcon();
      }
    } catch {
      icon = this.createDefaultIcon();
    }

    this.tray = new Tray(icon);
    this.tray.setToolTip('Desktop Avatar');

    this.updateMenu();

    // Double-click to show/hide
    this.tray.on('double-click', () => {
      this.toggleVisibility();
    });
  }

  /**
   * Get platform-specific icon path
   */
  getIconPath() {
    const iconName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
    return path.join(__dirname, '../../assets', iconName);
  }

  /**
   * Create a simple default icon if no icon file exists
   */
  createDefaultIcon() {
    // Create a simple 16x16 icon
    const size = 16;
    const canvas = Buffer.alloc(size * size * 4);

    // Fill with a simple avatar silhouette (purple circle)
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const idx = (y * size + x) * 4;
        const cx = size / 2;
        const cy = size / 2;
        const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);

        if (dist < size / 2 - 1) {
          // Purple color
          canvas[idx] = 147;     // R
          canvas[idx + 1] = 112; // G
          canvas[idx + 2] = 219; // B
          canvas[idx + 3] = 255; // A
        } else {
          // Transparent
          canvas[idx] = 0;
          canvas[idx + 1] = 0;
          canvas[idx + 2] = 0;
          canvas[idx + 3] = 0;
        }
      }
    }

    return nativeImage.createFromBuffer(canvas, { width: size, height: size });
  }

  /**
   * Update the context menu
   */
  updateMenu() {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Show Avatar',
        click: () => this.showWindow()
      },
      {
        label: 'Hide Avatar',
        click: () => this.hideWindow()
      },
      { type: 'separator' },
      {
        label: 'Always on Top',
        type: 'checkbox',
        checked: this.isAlwaysOnTop,
        click: (menuItem) => this.toggleAlwaysOnTop(menuItem.checked)
      },
      { type: 'separator' },
      {
        label: 'Reset Position',
        click: () => this.resetPosition()
      },
      { type: 'separator' },
      {
        label: 'About',
        click: () => this.showAbout()
      },
      {
        label: 'Quit',
        click: () => this.quit()
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  /**
   * Toggle window visibility
   */
  toggleVisibility() {
    if (!this.mainWindow) return;

    if (this.mainWindow.isVisible()) {
      this.mainWindow.hide();
    } else {
      this.mainWindow.show();
    }
  }

  /**
   * Show the main window
   */
  showWindow() {
    if (this.mainWindow) {
      this.mainWindow.show();
    }
  }

  /**
   * Hide the main window
   */
  hideWindow() {
    if (this.mainWindow) {
      this.mainWindow.hide();
    }
  }

  /**
   * Toggle always on top
   */
  toggleAlwaysOnTop(value) {
    this.isAlwaysOnTop = value;
    if (this.mainWindow) {
      this.mainWindow.setAlwaysOnTop(value);
    }
    this.updateMenu();
  }

  /**
   * Reset avatar position to default
   */
  resetPosition() {
    if (this.mainWindow) {
      const { screen } = require('electron');
      const primaryDisplay = screen.getPrimaryDisplay();
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
      const [winWidth, winHeight] = this.mainWindow.getSize();

      const x = Math.round(screenWidth / 2 - winWidth / 2);
      const y = screenHeight - winHeight - 50;

      this.mainWindow.setPosition(x, y);
      this.mainWindow.show();
    }
  }

  /**
   * Show about dialog
   */
  showAbout() {
    const { dialog } = require('electron');
    dialog.showMessageBox({
      type: 'info',
      title: 'About Desktop Avatar',
      message: 'Desktop Avatar v0.1.0',
      detail: 'An animated desktop companion that sits on your windows.\n\nCreated with Electron + Three.js'
    });
  }

  /**
   * Quit the application
   */
  quit() {
    this.app.isQuitting = true;
    this.app.quit();
  }

  /**
   * Destroy the tray icon
   */
  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = TrayManager;

/**
 * Desktop Avatar - Main Process
 *
 * This is the entry point for the Electron application.
 * Handles window creation, system tray, and IPC communication.
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const WindowManager = require('./window-manager');
const TrayManager = require('./tray');

// Keep global references to prevent garbage collection
let mainWindow = null;
let windowManager = null;
let trayManager = null;

// Avatar settings
const AVATAR_CONFIG = {
  width: 350,
  height: 450,
  defaultX: null, // Will be set to screen center
  defaultY: null  // Will be set to screen bottom
};

/**
 * Creates the main transparent window for the avatar
 */
function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Default position: bottom center of screen
  AVATAR_CONFIG.defaultX = Math.round(screenWidth / 2 - AVATAR_CONFIG.width / 2);
  AVATAR_CONFIG.defaultY = screenHeight - AVATAR_CONFIG.height - 50;

  mainWindow = new BrowserWindow({
    width: AVATAR_CONFIG.width,
    height: AVATAR_CONFIG.height,
    x: AVATAR_CONFIG.defaultX,
    y: AVATAR_CONFIG.defaultY,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // Make window click-through except on the avatar itself
  mainWindow.setIgnoreMouseEvents(false);

  // Remove menu bar
  mainWindow.setMenu(null);

  // Load the renderer
  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Open DevTools only in development (uncomment to debug)
  // mainWindow.webContents.openDevTools({ mode: 'detach' });

  // Prevent window from being closed, hide instead
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

/**
 * Initialize the application
 */
async function initialize() {
  // Create the main window
  createWindow();

  // Initialize window manager for detecting system windows
  windowManager = new WindowManager();

  // Initialize system tray
  trayManager = new TrayManager(mainWindow, app);

  // Start window detection loop
  windowManager.startDetection();

  console.log('Desktop Avatar initialized successfully!');
  console.log(`Platform: ${process.platform}`);
}

// App event handlers
app.whenReady().then(initialize);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  } else if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (windowManager) {
    windowManager.stopDetection();
  }
});

// ============================================
// IPC Handlers - Communication with Renderer
// ============================================

/**
 * Get list of detected windows
 */
ipcMain.handle('get-windows', async () => {
  if (!windowManager) return [];
  return windowManager.getWindows();
});

/**
 * Get current avatar window position
 */
ipcMain.handle('get-avatar-position', async () => {
  if (!mainWindow) return { x: 0, y: 0 };
  const [x, y] = mainWindow.getPosition();
  return { x, y };
});

/**
 * Set avatar window position
 */
ipcMain.handle('set-avatar-position', async (event, { x, y }) => {
  if (!mainWindow) return false;
  mainWindow.setPosition(Math.round(x), Math.round(y));
  return true;
});

/**
 * Get avatar window size
 */
ipcMain.handle('get-avatar-size', async () => {
  if (!mainWindow) return { width: 0, height: 0 };
  const [width, height] = mainWindow.getSize();
  return { width, height };
});

/**
 * Set avatar window size
 */
ipcMain.handle('set-avatar-size', async (event, { width, height }) => {
  if (!mainWindow) return false;
  mainWindow.setSize(Math.round(width), Math.round(height));
  return true;
});

/**
 * Get screen information
 */
ipcMain.handle('get-screen-info', async () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    width: primaryDisplay.workAreaSize.width,
    height: primaryDisplay.workAreaSize.height,
    scaleFactor: primaryDisplay.scaleFactor
  };
});

/**
 * Set always on top
 */
ipcMain.handle('set-always-on-top', async (event, value) => {
  if (!mainWindow) return false;
  mainWindow.setAlwaysOnTop(value);
  return true;
});

/**
 * Set click-through mode (for areas outside avatar)
 */
ipcMain.handle('set-ignore-mouse', async (event, ignore, options = {}) => {
  if (!mainWindow) return false;
  mainWindow.setIgnoreMouseEvents(ignore, options);
  return true;
});

/**
 * Get taskbar information
 */
ipcMain.handle('get-taskbar-info', async () => {
  if (!windowManager) return null;
  return windowManager.getTaskbarInfo();
});

/**
 * Trigger window detection refresh
 */
ipcMain.handle('refresh-windows', async () => {
  if (!windowManager) return [];
  await windowManager.detectWindows();
  return windowManager.getWindows();
});

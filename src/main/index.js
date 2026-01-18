/**
 * Desktop Avatar - Main Process
 *
 * This is the entry point for the Electron application.
 * Handles window creation, system tray, and IPC communication.
 */

const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const WindowManager = require('./window-manager');
const TrayManager = require('./tray');

// Keep global references to prevent garbage collection
let selectorWindow = null;
let mainWindow = null;
let windowManager = null;
let trayManager = null;
let currentMode = null;

// Config file path
const configPath = path.join(app.getPath('userData'), 'avatar-config.json');

// Avatar settings
const AVATAR_CONFIG = {
  width: 400,
  height: 450,
  defaultX: null,
  defaultY: null
};

/**
 * Load saved configuration
 */
function loadConfig() {
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading config:', error);
  }
  return { mode: 'selector', remember: false };
}

/**
 * Save configuration
 */
function saveConfig(config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  } catch (error) {
    console.error('Error saving config:', error);
  }
}

/**
 * Creates the mode selector window
 */
function createSelectorWindow() {
  selectorWindow = new BrowserWindow({
    width: 500,
    height: 450,
    resizable: false,
    frame: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  selectorWindow.loadFile(path.join(__dirname, '../renderer/mode-selector.html'));

  selectorWindow.on('closed', () => {
    selectorWindow = null;
  });

  return selectorWindow;
}

/**
 * Creates the main transparent window for the avatar
 */
function createAvatarWindow(mode) {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Default position: bottom-right corner, above taskbar
  AVATAR_CONFIG.defaultX = screenWidth - AVATAR_CONFIG.width - 20;
  AVATAR_CONFIG.defaultY = screenHeight - AVATAR_CONFIG.height;

  mainWindow = new BrowserWindow({
    width: AVATAR_CONFIG.width,
    height: AVATAR_CONFIG.height,
    x: AVATAR_CONFIG.defaultX,
    y: AVATAR_CONFIG.defaultY,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    resizable: false,
    hasShadow: false,
    // Fix for Windows transparent window gray border
    backgroundColor: '#00000000',
    roundedCorners: false,
    thickFrame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      // Enable hardware acceleration for transparency
      offscreen: false
    }
  });

  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.setAlwaysOnTop(true, 'floating');
  mainWindow.setMenu(null);

  // Load the appropriate renderer based on mode
  const rendererFile = mode === 'pngtuber'
    ? '../renderer/pngtuber.html'
    : '../renderer/index.html';

  mainWindow.loadFile(path.join(__dirname, rendererFile));

  // Open DevTools for debugging
  mainWindow.webContents.openDevTools({ mode: 'detach' });

  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Initialize managers
  windowManager = new WindowManager();
  trayManager = new TrayManager(mainWindow, app);
  windowManager.startDetection();

  currentMode = mode;
  console.log(`Desktop Avatar initialized in ${mode} mode!`);
  console.log(`Platform: ${process.platform}`);

  return mainWindow;
}

/**
 * Initialize the application
 */
async function initialize() {
  const config = loadConfig();

  // If user chose to remember and has a valid mode, skip selector
  if (config.remember && config.mode && config.mode !== 'selector') {
    createAvatarWindow(config.mode);
  } else {
    createSelectorWindow();
  }
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
    initialize();
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
// IPC Handlers - Mode Selection
// ============================================

/**
 * Get saved mode preference
 */
ipcMain.handle('get-saved-mode', async () => {
  const config = loadConfig();
  return config.mode;
});

/**
 * Handle mode selection from selector window
 */
ipcMain.on('mode-selected', (event, { mode, remember }) => {
  console.log(`Mode selected: ${mode}, remember: ${remember}`);

  // Save preference
  saveConfig({ mode: remember ? mode : 'selector', remember });

  // Close selector window
  if (selectorWindow) {
    selectorWindow.close();
  }

  // Create avatar window with selected mode
  createAvatarWindow(mode);
});

/**
 * Get current avatar mode
 */
ipcMain.handle('get-current-mode', async () => {
  return currentMode;
});

/**
 * Reset mode preference (show selector on next start)
 */
ipcMain.handle('reset-mode-preference', async () => {
  saveConfig({ mode: 'selector', remember: false });
  return true;
});

// ============================================
// IPC Handlers - Avatar Window
// ============================================

ipcMain.handle('get-windows', async () => {
  if (!windowManager) return [];
  return windowManager.getWindows();
});

ipcMain.handle('get-avatar-position', async () => {
  if (!mainWindow) return { x: 0, y: 0 };
  const [x, y] = mainWindow.getPosition();
  return { x, y };
});

ipcMain.handle('set-avatar-position', async (event, { x, y }) => {
  if (!mainWindow) return false;
  mainWindow.setPosition(Math.round(x), Math.round(y));
  return true;
});

ipcMain.handle('get-avatar-size', async () => {
  if (!mainWindow) return { width: 0, height: 0 };
  const [width, height] = mainWindow.getSize();
  return { width, height };
});

ipcMain.handle('set-avatar-size', async (event, { width, height }) => {
  if (!mainWindow) return false;
  mainWindow.setSize(Math.round(width), Math.round(height));
  return true;
});

ipcMain.handle('get-screen-info', async () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  return {
    width: primaryDisplay.workAreaSize.width,
    height: primaryDisplay.workAreaSize.height,
    scaleFactor: primaryDisplay.scaleFactor
  };
});

ipcMain.handle('set-always-on-top', async (event, value) => {
  if (!mainWindow) return false;
  mainWindow.setAlwaysOnTop(value);
  return true;
});

ipcMain.handle('set-ignore-mouse', async (event, ignore, options = {}) => {
  if (!mainWindow) return false;
  mainWindow.setIgnoreMouseEvents(ignore, options);
  return true;
});

ipcMain.handle('get-taskbar-info', async () => {
  if (!windowManager) return null;
  return windowManager.getTaskbarInfo();
});

ipcMain.handle('refresh-windows', async () => {
  if (!windowManager) return [];
  await windowManager.detectWindows();
  return windowManager.getWindows();
});

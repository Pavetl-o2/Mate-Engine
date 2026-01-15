/**
 * Preload Script - Secure bridge between main and renderer
 */

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

// Get the correct assets path
const assetsPath = path.join(__dirname, '../../assets');

// Expose protected methods to renderer
contextBridge.exposeInMainWorld('avatarAPI', {
  // Window detection
  getWindows: () => ipcRenderer.invoke('get-windows'),
  refreshWindows: () => ipcRenderer.invoke('refresh-windows'),
  getTaskbarInfo: () => ipcRenderer.invoke('get-taskbar-info'),

  // Avatar positioning
  getPosition: () => ipcRenderer.invoke('get-avatar-position'),
  setPosition: (x, y) => ipcRenderer.invoke('set-avatar-position', { x, y }),
  getSize: () => ipcRenderer.invoke('get-avatar-size'),
  setSize: (width, height) => ipcRenderer.invoke('set-avatar-size', { width, height }),

  // Screen info
  getScreenInfo: () => ipcRenderer.invoke('get-screen-info'),

  // Window behavior
  setAlwaysOnTop: (value) => ipcRenderer.invoke('set-always-on-top', value),
  setIgnoreMouse: (ignore, options) => ipcRenderer.invoke('set-ignore-mouse', ignore, options),

  // Paths
  assetsPath: assetsPath,
  modelsPath: path.join(assetsPath, 'models'),

  // Platform info
  platform: process.platform
});

window.addEventListener('DOMContentLoaded', () => {
  console.log('Desktop Avatar loaded');
  console.log('Assets path:', assetsPath);
});

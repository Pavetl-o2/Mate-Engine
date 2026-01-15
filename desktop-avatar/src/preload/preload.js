/**
 * Preload Script - Secure bridge between main and renderer
 *
 * Exposes safe APIs to the renderer process via contextBridge
 */

const { contextBridge, ipcRenderer } = require('electron');

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

  // Events from main process
  onWindowsUpdated: (callback) => {
    ipcRenderer.on('windows-updated', (event, windows) => callback(windows));
  },

  // Platform info
  platform: process.platform
});

// Notify renderer when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  console.log('Desktop Avatar renderer loaded');
});

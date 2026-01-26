/**
 * Preload Script - Secure bridge between main and renderer
 */

const { contextBridge, ipcRenderer } = require('electron');
const path = require('path');

// Get the correct assets path
const assetsPath = path.join(__dirname, '../../assets');

// Expose AI API to renderer
contextBridge.exposeInMainWorld('aiAPI', {
  // Configuration
  getConfig: () => ipcRenderer.invoke('ai:get-config'),
  setConfig: (config) => ipcRenderer.invoke('ai:set-config', config),

  // Health check
  healthCheck: () => ipcRenderer.invoke('ai:health-check'),

  // Chat
  chat: (message, sessionId = null) => ipcRenderer.invoke('ai:chat', message, sessionId),
  chatWithVoice: (message, sessionId = null) => ipcRenderer.invoke('ai:chat-text', message, true, sessionId),

  // Voice processing
  processVoice: (audioBase64, sessionId = null) => ipcRenderer.invoke('ai:process-voice', audioBase64, sessionId),

  // Individual services
  textToSpeech: (text) => ipcRenderer.invoke('ai:text-to-speech', text),
  speechToText: (audioBase64, mimeType = 'audio/wav') => ipcRenderer.invoke('ai:speech-to-text', audioBase64, mimeType),

  // Session
  resetSession: (sessionId = null) => ipcRenderer.invoke('ai:reset-session', sessionId),

  // Helper: Convert blob to base64
  blobToBase64: async (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64 = reader.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  },

  // Helper: Play audio from base64
  playAudio: async (base64Audio) => {
    const audioBlob = new Blob(
      [Uint8Array.from(atob(base64Audio), c => c.charCodeAt(0))],
      { type: 'audio/mpeg' }
    );
    const audioUrl = URL.createObjectURL(audioBlob);
    const audio = new Audio(audioUrl);
    await audio.play();
    audio.onended = () => URL.revokeObjectURL(audioUrl);
    return audio;
  }
});

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

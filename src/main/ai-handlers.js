/**
 * AI IPC Handlers - Bridge between renderer and AI service
 *
 * Register these handlers in your main process to enable AI functionality
 */

const { ipcMain } = require('electron');
const { AIService } = require('./ai-service');

// Singleton AI service instance
let aiService = null;

/**
 * Initialize and get the AI service instance
 */
function getAIService() {
  if (!aiService) {
    aiService = new AIService();
  }
  return aiService;
}

/**
 * Register all AI-related IPC handlers
 */
function registerAIHandlers() {
  const service = getAIService();

  // Get current configuration
  ipcMain.handle('ai:get-config', () => {
    return service.getConfig();
  });

  // Set configuration
  ipcMain.handle('ai:set-config', (event, config) => {
    service.configure(config);
    return { ok: true };
  });

  // Health check
  ipcMain.handle('ai:health-check', async () => {
    return await service.healthCheck();
  });

  // Text chat (returns text only)
  ipcMain.handle('ai:chat', async (event, message, sessionId = null) => {
    return await service.chat(message, sessionId);
  });

  // Text chat with voice response
  ipcMain.handle('ai:chat-text', async (event, message, withVoice = false, sessionId = null) => {
    const result = await service.processText(message, withVoice, sessionId);

    // Convert audio buffer to base64 for IPC transfer
    if (result.audio) {
      result.audio = result.audio.toString('base64');
    }

    return result;
  });

  // Process voice input (full pipeline: STT -> Chat -> TTS)
  ipcMain.handle('ai:process-voice', async (event, audioBase64, sessionId = null) => {
    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioBase64, 'base64');

    const result = await service.processVoice(audioBuffer, sessionId);

    // Convert audio buffer to base64 for IPC transfer
    if (result.audio) {
      result.audio = result.audio.toString('base64');
    }

    return result;
  });

  // Text to speech only
  ipcMain.handle('ai:text-to-speech', async (event, text) => {
    const result = await service.textToSpeech(text);

    if (result.ok && result.audio) {
      result.audio = result.audio.toString('base64');
    }

    return result;
  });

  // Speech to text only
  ipcMain.handle('ai:speech-to-text', async (event, audioBase64, mimeType = 'audio/wav') => {
    const audioBuffer = Buffer.from(audioBase64, 'base64');
    return await service.speechToText(audioBuffer, mimeType);
  });

  // Reset session
  ipcMain.handle('ai:reset-session', async (event, sessionId = null) => {
    return await service.resetSession(sessionId);
  });

  console.log('[AI Handlers] Registered all AI IPC handlers');
}

/**
 * Unregister all AI-related IPC handlers
 */
function unregisterAIHandlers() {
  const handlers = [
    'ai:get-config',
    'ai:set-config',
    'ai:health-check',
    'ai:chat',
    'ai:chat-text',
    'ai:process-voice',
    'ai:text-to-speech',
    'ai:speech-to-text',
    'ai:reset-session'
  ];

  handlers.forEach(channel => {
    ipcMain.removeHandler(channel);
  });

  console.log('[AI Handlers] Unregistered all AI IPC handlers');
}

module.exports = {
  registerAIHandlers,
  unregisterAIHandlers,
  getAIService
};

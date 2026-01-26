/**
 * AI Chat Example - Shows how to use the AI API in the renderer
 *
 * This example demonstrates:
 * - Configuring the AI service
 * - Sending text messages
 * - Push-to-talk voice recording
 * - Playing audio responses
 */

// ============================================================================
// Configuration
// ============================================================================

/**
 * Configure the AI service on startup
 */
async function configureAI() {
  await window.aiAPI.setConfig({
    // Clawdbot server on EC2
    clawdbotUrl: 'http://YOUR_EC2_IP:3000',
    clawdbotToken: 'your-token-here', // Optional

    // Session ID (unique per character/conversation)
    sessionId: 'jinx-main',

    // Deepgram for Speech-to-Text
    deepgramApiKey: 'your-deepgram-key',

    // ElevenLabs for Text-to-Speech
    elevenLabsApiKey: 'your-elevenlabs-key',
    elevenLabsVoiceId: 'k9294w367tNmQIywtFJI' // Jinx voice
  });

  // Check if server is healthy
  const health = await window.aiAPI.healthCheck();
  console.log('Server health:', health);

  return health.ok;
}

// ============================================================================
// Text Chat
// ============================================================================

/**
 * Send a text message and get a response
 */
async function sendMessage(message) {
  console.log('Sending:', message);

  // Text only
  const result = await window.aiAPI.chat(message);

  if (result.ok) {
    console.log('Response:', result.response);
    return result.response;
  } else {
    console.error('Error:', result.error);
    return null;
  }
}

/**
 * Send a text message and get voice response
 */
async function sendMessageWithVoice(message) {
  console.log('Sending with voice:', message);

  const result = await window.aiAPI.chatWithVoice(message);

  if (result.ok) {
    console.log('Response:', result.response);

    // Play audio if available
    if (result.audio) {
      await window.aiAPI.playAudio(result.audio);
    }

    return result.response;
  } else {
    console.error('Error:', result.error);
    return null;
  }
}

// ============================================================================
// Voice Chat (Push-to-Talk)
// ============================================================================

let mediaRecorder = null;
let audioChunks = [];

/**
 * Start recording from microphone
 */
async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
      }
    };

    mediaRecorder.start(100); // Collect data every 100ms
    console.log('Recording started...');

    return true;
  } catch (error) {
    console.error('Failed to start recording:', error);
    return false;
  }
}

/**
 * Stop recording and send to AI
 */
async function stopRecordingAndSend() {
  if (!mediaRecorder || mediaRecorder.state === 'inactive') {
    console.log('Not recording');
    return null;
  }

  return new Promise((resolve) => {
    mediaRecorder.onstop = async () => {
      console.log('Recording stopped, processing...');

      // Combine audio chunks
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });

      // Convert to base64
      const base64Audio = await window.aiAPI.blobToBase64(audioBlob);

      // Send to AI for processing
      const result = await window.aiAPI.processVoice(base64Audio);

      if (result.ok) {
        console.log('Transcription:', result.transcription);
        console.log('Response:', result.response);

        // Play audio response
        if (result.audio) {
          await window.aiAPI.playAudio(result.audio);
        }

        resolve(result);
      } else {
        console.error('Error:', result.error);
        resolve(null);
      }
    };

    mediaRecorder.stop();

    // Stop all tracks
    mediaRecorder.stream.getTracks().forEach(track => track.stop());
  });
}

/**
 * Setup push-to-talk with a key (default: Space)
 */
function setupPushToTalk(key = ' ') {
  let isRecording = false;

  document.addEventListener('keydown', async (e) => {
    if (e.key === key && !isRecording) {
      isRecording = true;
      await startRecording();
    }
  });

  document.addEventListener('keyup', async (e) => {
    if (e.key === key && isRecording) {
      isRecording = false;
      await stopRecordingAndSend();
    }
  });

  console.log(`Push-to-talk enabled. Hold "${key === ' ' ? 'Space' : key}" to talk.`);
}

// ============================================================================
// Integration Example
// ============================================================================

/**
 * Example: Integrate with your avatar UI
 */
class AvatarChat {
  constructor() {
    this.isConfigured = false;
    this.onResponse = null;
    this.onError = null;
  }

  async init(config, callbacks = {}) {
    await window.aiAPI.setConfig(config);

    const health = await window.aiAPI.healthCheck();
    this.isConfigured = health.ok;

    if (callbacks.onResponse) this.onResponse = callbacks.onResponse;
    if (callbacks.onError) this.onError = callbacks.onError;

    return this.isConfigured;
  }

  async speak(message, withVoice = true) {
    if (!this.isConfigured) {
      const error = 'AI not configured';
      if (this.onError) this.onError(error);
      return null;
    }

    try {
      const result = withVoice
        ? await window.aiAPI.chatWithVoice(message)
        : await window.aiAPI.chat(message);

      if (result.ok) {
        if (this.onResponse) this.onResponse(result.response);

        if (result.audio) {
          await window.aiAPI.playAudio(result.audio);
        }

        return result.response;
      } else {
        if (this.onError) this.onError(result.error);
        return null;
      }
    } catch (error) {
      if (this.onError) this.onError(error.message);
      return null;
    }
  }

  async reset() {
    return await window.aiAPI.resetSession();
  }
}

// ============================================================================
// Exports for module usage
// ============================================================================

// If using modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    configureAI,
    sendMessage,
    sendMessageWithVoice,
    startRecording,
    stopRecordingAndSend,
    setupPushToTalk,
    AvatarChat
  };
}

// For direct script usage, attach to window
if (typeof window !== 'undefined') {
  window.AIChat = {
    configureAI,
    sendMessage,
    sendMessageWithVoice,
    startRecording,
    stopRecordingAndSend,
    setupPushToTalk,
    AvatarChat
  };
}

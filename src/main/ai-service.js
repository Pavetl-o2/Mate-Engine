/**
 * AI Service - Handles communication with Clawdbot, Deepgram, and ElevenLabs
 *
 * This service provides:
 * - Text chat with Clawdbot AI
 * - Speech-to-Text via Deepgram
 * - Text-to-Speech via ElevenLabs
 */

const https = require('https');
const http = require('http');

class AIService {
  constructor() {
    // Clawdbot server configuration
    this.clawdbotUrl = '';
    this.clawdbotToken = '';
    this.sessionId = 'main';

    // Deepgram configuration
    this.deepgramApiKey = '';

    // ElevenLabs configuration
    this.elevenLabsApiKey = '';
    this.elevenLabsVoiceId = 'k9294w367tNmQIywtFJI'; // Jinx voice

    // Timeouts
    this.timeout = 60000;
  }

  /**
   * Configure the AI service
   */
  configure(config) {
    if (config.clawdbotUrl) this.clawdbotUrl = config.clawdbotUrl;
    if (config.clawdbotToken) this.clawdbotToken = config.clawdbotToken;
    if (config.sessionId) this.sessionId = config.sessionId;
    if (config.deepgramApiKey) this.deepgramApiKey = config.deepgramApiKey;
    if (config.elevenLabsApiKey) this.elevenLabsApiKey = config.elevenLabsApiKey;
    if (config.elevenLabsVoiceId) this.elevenLabsVoiceId = config.elevenLabsVoiceId;
    if (config.timeout) this.timeout = config.timeout;
  }

  /**
   * Get current configuration (without sensitive keys)
   */
  getConfig() {
    return {
      clawdbotUrl: this.clawdbotUrl,
      sessionId: this.sessionId,
      hasClawdbotToken: !!this.clawdbotToken,
      hasDeepgramKey: !!this.deepgramApiKey,
      hasElevenLabsKey: !!this.elevenLabsApiKey,
      elevenLabsVoiceId: this.elevenLabsVoiceId
    };
  }

  /**
   * HTTP request helper
   */
  async makeRequest(url, options, data = null) {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const protocol = parsedUrl.protocol === 'https:' ? https : http;

      const req = protocol.request(url, options, (res) => {
        let body = [];

        res.on('data', chunk => body.push(chunk));
        res.on('end', () => {
          const buffer = Buffer.concat(body);

          // Check if response is JSON
          const contentType = res.headers['content-type'] || '';
          if (contentType.includes('application/json')) {
            try {
              resolve({ status: res.statusCode, data: JSON.parse(buffer.toString()) });
            } catch (e) {
              resolve({ status: res.statusCode, data: buffer.toString() });
            }
          } else {
            // Return as buffer for binary data (audio)
            resolve({ status: res.statusCode, data: buffer });
          }
        });
      });

      req.on('error', reject);
      req.setTimeout(this.timeout, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (data) {
        req.write(typeof data === 'string' ? data : JSON.stringify(data));
      }
      req.end();
    });
  }

  /**
   * Check if Clawdbot server is healthy
   */
  async healthCheck() {
    if (!this.clawdbotUrl) {
      return { ok: false, error: 'Clawdbot URL not configured' };
    }

    try {
      const response = await this.makeRequest(
        `${this.clawdbotUrl}/health`,
        { method: 'GET', timeout: 5000 }
      );

      return {
        ok: response.status === 200 && response.data?.status === 'ok',
        clawdbot: response.data?.clawdbot
      };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Send a chat message to Clawdbot
   */
  async chat(message, sessionId = null) {
    if (!this.clawdbotUrl) {
      return { ok: false, error: 'Clawdbot URL not configured' };
    }

    if (!message || message.trim() === '') {
      return { ok: false, error: 'Message cannot be empty' };
    }

    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      if (this.clawdbotToken) {
        headers['Authorization'] = `Bearer ${this.clawdbotToken}`;
      }

      const response = await this.makeRequest(
        `${this.clawdbotUrl}/chat`,
        { method: 'POST', headers },
        { message, sessionId: sessionId || this.sessionId }
      );

      if (response.status === 200 && response.data?.success) {
        return {
          ok: true,
          response: response.data.response,
          sessionId: response.data.sessionId
        };
      } else {
        return {
          ok: false,
          error: response.data?.error || 'Unknown error'
        };
      }
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Convert speech to text using Deepgram
   */
  async speechToText(audioBuffer, mimeType = 'audio/wav') {
    if (!this.deepgramApiKey) {
      return { ok: false, error: 'Deepgram API key not configured' };
    }

    try {
      const response = await this.makeRequest(
        'https://api.deepgram.com/v1/listen?model=nova-2&language=en',
        {
          method: 'POST',
          headers: {
            'Authorization': `Token ${this.deepgramApiKey}`,
            'Content-Type': mimeType
          }
        },
        audioBuffer
      );

      if (response.status === 200) {
        const transcript = response.data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
        return { ok: true, text: transcript || '' };
      } else {
        return { ok: false, error: response.data?.error || 'Deepgram error' };
      }
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Convert text to speech using ElevenLabs
   */
  async textToSpeech(text) {
    if (!this.elevenLabsApiKey) {
      return { ok: false, error: 'ElevenLabs API key not configured' };
    }

    if (!text || text.trim() === '') {
      return { ok: false, error: 'Text cannot be empty' };
    }

    try {
      const response = await this.makeRequest(
        `https://api.elevenlabs.io/v1/text-to-speech/${this.elevenLabsVoiceId}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'xi-api-key': this.elevenLabsApiKey
          }
        },
        {
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75
          }
        }
      );

      if (response.status === 200) {
        // Response is audio buffer
        return { ok: true, audio: response.data };
      } else {
        return { ok: false, error: 'ElevenLabs error' };
      }
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  /**
   * Full voice interaction: STT -> Chat -> TTS
   */
  async processVoice(audioBuffer, sessionId = null) {
    // 1. Speech to text
    const sttResult = await this.speechToText(audioBuffer);
    if (!sttResult.ok) {
      return { ok: false, error: `STT failed: ${sttResult.error}` };
    }

    console.log('[AIService] Transcribed:', sttResult.text);

    // 2. Chat with Clawdbot
    const chatResult = await this.chat(sttResult.text, sessionId);
    if (!chatResult.ok) {
      return { ok: false, error: `Chat failed: ${chatResult.error}` };
    }

    console.log('[AIService] Response:', chatResult.response);

    // 3. Text to speech
    const ttsResult = await this.textToSpeech(chatResult.response);
    if (!ttsResult.ok) {
      return {
        ok: true,
        transcription: sttResult.text,
        response: chatResult.response,
        audio: null,
        warning: `TTS failed: ${ttsResult.error}`
      };
    }

    return {
      ok: true,
      transcription: sttResult.text,
      response: chatResult.response,
      audio: ttsResult.audio
    };
  }

  /**
   * Text chat with optional TTS response
   */
  async processText(message, withVoice = false, sessionId = null) {
    // Chat with Clawdbot
    const chatResult = await this.chat(message, sessionId);
    if (!chatResult.ok) {
      return { ok: false, error: chatResult.error };
    }

    if (!withVoice) {
      return {
        ok: true,
        response: chatResult.response
      };
    }

    // Get TTS
    const ttsResult = await this.textToSpeech(chatResult.response);

    return {
      ok: true,
      response: chatResult.response,
      audio: ttsResult.ok ? ttsResult.audio : null,
      warning: ttsResult.ok ? null : `TTS failed: ${ttsResult.error}`
    };
  }

  /**
   * Reset the conversation session
   */
  async resetSession(sessionId = null) {
    if (!this.clawdbotUrl) {
      return { ok: false, error: 'Clawdbot URL not configured' };
    }

    try {
      const headers = {
        'Content-Type': 'application/json'
      };

      if (this.clawdbotToken) {
        headers['Authorization'] = `Bearer ${this.clawdbotToken}`;
      }

      const response = await this.makeRequest(
        `${this.clawdbotUrl}/session/reset`,
        { method: 'POST', headers },
        { sessionId: sessionId || this.sessionId }
      );

      return { ok: response.status === 200 };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }
}

module.exports = { AIService };

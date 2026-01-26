# AI Integration Guide for Mate-Engine (Electron)

This guide explains how to integrate Clawdbot AI with your Mate-Engine desktop avatar using text and voice chat.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Mate-Engine (Electron)                         │
├─────────────────────────────────────────────────────────────────┤
│  Renderer Process                                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ai-chat-example.js                                          ││
│  │ - configureAI(), sendMessage(), processVoice()              ││
│  │ - Push-to-talk voice recording                              ││
│  └─────────────────────────────────────────────────────────────┘│
│                            │                                     │
│                            │ window.aiAPI                        │
│                            ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ preload.js (contextBridge)                                  ││
│  │ - Exposes aiAPI to renderer                                 ││
│  │ - blobToBase64(), playAudio() helpers                       ││
│  └─────────────────────────────────────────────────────────────┘│
│                            │                                     │
│                            │ ipcRenderer.invoke()                │
│                            ▼                                     │
│  Main Process                                                    │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ai-handlers.js (IPC Handlers)                               ││
│  │ - ai:chat, ai:process-voice, ai:text-to-speech, etc.        ││
│  └─────────────────────────────────────────────────────────────┘│
│                            │                                     │
│                            ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ ai-service.js (AIService class)                             ││
│  │ - speechToText() → Deepgram API                             ││
│  │ - chat() → Clawdbot Server                                  ││
│  │ - textToSpeech() → ElevenLabs API                           ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                            │
                            │ HTTP
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        AWS EC2 Server                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ clawdbot-server.js (HTTP wrapper)                           ││
│  │ - POST /chat → executes clawdbot CLI                        ││
│  │ - POST /session/reset                                       ││
│  │ - GET /health                                               ││
│  └─────────────────────────────────────────────────────────────┘│
│                            │                                     │
│                            ▼                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ Clawdbot CLI                                                ││
│  │ - AI agent with tools and memory                            ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## Setup Steps

### Step 1: Register AI Handlers in Main Process

Edit your `src/main/index.js` to register the AI handlers:

```javascript
const { app, BrowserWindow } = require('electron');
const { registerAIHandlers } = require('./ai-handlers');

app.whenReady().then(() => {
  // Register AI handlers BEFORE creating windows
  registerAIHandlers();

  // Create your window...
  createWindow();
});
```

### Step 2: Deploy Clawdbot Server to EC2

SSH into your EC2 instance and set up the server:

```bash
# Connect to EC2
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# Create server directory
mkdir -p ~/clawdbot-server
cd ~/clawdbot-server

# Initialize npm and install express
npm init -y
npm install express

# Copy clawdbot-server.js from this repo
# (copy the content from server/clawdbot-server.js)
nano clawdbot-server.js

# Install pm2 for process management
sudo npm install -g pm2

# Start the server
pm2 start clawdbot-server.js --name "clawdbot-api"

# Save pm2 config
pm2 save
pm2 startup
```

### Step 3: Open Port 3000 in AWS Security Group

1. Go to AWS Console → EC2 → Security Groups
2. Select your instance's security group
3. Edit inbound rules
4. Add rule:
   - Type: Custom TCP
   - Port: 3000
   - Source: 0.0.0.0/0 (or restrict to your IP)

### Step 4: Configure in Renderer

In your renderer code (or using the example):

```javascript
// Configure on app startup
await window.aiAPI.setConfig({
  clawdbotUrl: 'http://YOUR_EC2_IP:3000',
  clawdbotToken: '', // Optional authentication token
  sessionId: 'avatar-main',
  deepgramApiKey: 'YOUR_DEEPGRAM_KEY',
  elevenLabsApiKey: 'YOUR_ELEVENLABS_KEY',
  elevenLabsVoiceId: 'k9294w367tNmQIywtFJI' // Jinx voice
});

// Check connection
const health = await window.aiAPI.healthCheck();
console.log('Connected:', health.ok);
```

## Usage Examples

### Text Chat

```javascript
// Simple text chat
const result = await window.aiAPI.chat('Hello, how are you?');
if (result.ok) {
  console.log('Response:', result.response);
}

// Text chat with voice response
const result = await window.aiAPI.chatWithVoice('Tell me a joke');
if (result.ok) {
  console.log('Response:', result.response);
  if (result.audio) {
    await window.aiAPI.playAudio(result.audio);
  }
}
```

### Voice Chat (Push-to-Talk)

```javascript
// In ai-chat-example.js, use setupPushToTalk()
setupPushToTalk(' '); // Space key for push-to-talk

// Or manually:
await startRecording();
// ... user speaks ...
const result = await stopRecordingAndSend();
// result.transcription = what user said
// result.response = AI response
// result.audio = audio to play
```

### Avatar Integration Class

```javascript
const chat = new AvatarChat();

await chat.init({
  clawdbotUrl: 'http://YOUR_EC2_IP:3000',
  deepgramApiKey: 'YOUR_KEY',
  elevenLabsApiKey: 'YOUR_KEY'
}, {
  onResponse: (text) => {
    // Update UI, trigger lip sync, etc.
    updateSubtitles(text);
    triggerTalkingAnimation();
  },
  onError: (error) => {
    console.error('AI Error:', error);
  }
});

// Make avatar speak
await chat.speak('Hello user!');
```

## API Reference

### window.aiAPI

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `setConfig(config)` | config object | `{ok}` | Set AI service configuration |
| `getConfig()` | - | config object | Get current configuration |
| `healthCheck()` | - | `{ok, clawdbot}` | Check server connection |
| `chat(message, sessionId?)` | string, string? | `{ok, response}` | Text chat |
| `chatWithVoice(message, sessionId?)` | string, string? | `{ok, response, audio}` | Text chat + TTS |
| `processVoice(audioBase64, sessionId?)` | string, string? | `{ok, transcription, response, audio}` | Full voice pipeline |
| `textToSpeech(text)` | string | `{ok, audio}` | Convert text to speech |
| `speechToText(audioBase64, mimeType?)` | string, string? | `{ok, text}` | Convert speech to text |
| `resetSession(sessionId?)` | string? | `{ok}` | Reset conversation |
| `blobToBase64(blob)` | Blob | string | Helper: convert blob |
| `playAudio(base64Audio)` | string | Audio | Helper: play audio |

## API Keys

| Service | Purpose | Get Key |
|---------|---------|---------|
| **Deepgram** | Speech-to-Text | https://console.deepgram.com |
| **ElevenLabs** | Text-to-Speech | https://elevenlabs.io |

## Troubleshooting

### "Server not responding"
- Check EC2 instance is running
- Verify port 3000 is open in security group
- Check pm2 status: `pm2 status`
- View logs: `pm2 logs clawdbot-api`

### "Clawdbot not found"
- Verify Clawdbot is installed: `clawdbot --version`
- Check path in server config: `CLAWDBOT_PATH`
- Install if needed: `npm install -g clawdbot`

### Audio not playing
- Check browser console for errors
- Verify ElevenLabs API key is valid
- Check voice ID exists

### Speech not recognized
- Check microphone permissions
- Verify Deepgram API key
- Test recording works: check console logs

## Security Notes

1. **Never expose API keys in client builds** - Keep them server-side or use environment variables
2. **Use HTTPS in production** - Set up SSL/TLS for the EC2 server
3. **Restrict CORS** - Update server to only allow your app's origin
4. **Use authentication** - Set AUTH_TOKEN in server environment

## File Structure

```
src/
├── main/
│   ├── index.js          # Add: registerAIHandlers()
│   ├── ai-service.js     # Core AI service
│   └── ai-handlers.js    # IPC handlers
├── preload/
│   └── preload.js        # Updated with aiAPI
├── renderer/
│   └── ai-chat-example.js # Example usage
server/
└── clawdbot-server.js    # Deploy to EC2
docs/
└── AI-INTEGRATION.md     # This file
```

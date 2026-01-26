/**
 * Clawdbot HTTP Server
 *
 * HTTP wrapper for Clawdbot CLI to be deployed on AWS EC2.
 * Provides synchronous HTTP endpoints for Electron app integration.
 *
 * Usage:
 *   npm init -y
 *   npm install express
 *   node clawdbot-server.js
 *
 * Endpoints:
 *   GET  /health         - Health check
 *   POST /chat           - Send message and get response
 *   POST /session/reset  - Reset conversation session
 */

const express = require('express');
const { exec } = require('child_process');
const util = require('util');

const execPromise = util.promisify(exec);

const app = express();
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 3000;
const CLAWDBOT_PATH = process.env.CLAWDBOT_PATH || '/home/ubuntu/.npm-global/bin/clawdbot';
const AUTH_TOKEN = process.env.AUTH_TOKEN || '';
const MAX_MESSAGE_LENGTH = 10000;

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});

// Auth middleware
const authMiddleware = (req, res, next) => {
    if (!AUTH_TOKEN) {
        return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || authHeader !== `Bearer ${AUTH_TOKEN}`) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
};

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const { stdout } = await execPromise(`${CLAWDBOT_PATH} --version`, { timeout: 5000 });
        res.json({
            status: 'ok',
            clawdbot: stdout.trim(),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            status: 'error',
            error: 'Clawdbot not available',
            details: error.message
        });
    }
});

// Chat endpoint
app.post('/chat', authMiddleware, async (req, res) => {
    const { message, sessionId = 'main' } = req.body;

    if (!message) {
        return res.status(400).json({
            success: false,
            error: 'Message is required'
        });
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({
            success: false,
            error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`
        });
    }

    try {
        // Escape message for shell
        const escapedMessage = message
            .replace(/\\/g, '\\\\')
            .replace(/"/g, '\\"')
            .replace(/`/g, '\\`')
            .replace(/\$/g, '\\$');

        // Build command
        const command = `${CLAWDBOT_PATH} agent --message "${escapedMessage}" --session-id ${sessionId} 2>/dev/null | grep -v '^[│◇🦞]' | grep -v '^$' | tail -n 1`;

        console.log(`[${new Date().toISOString()}] Processing message for session: ${sessionId}`);

        const { stdout, stderr } = await execPromise(command, {
            timeout: 120000, // 2 minute timeout
            maxBuffer: 1024 * 1024 * 10 // 10MB buffer
        });

        const response = stdout.trim();

        if (!response) {
            return res.json({
                success: false,
                error: 'No response from Clawdbot',
                sessionId
            });
        }

        console.log(`[${new Date().toISOString()}] Response sent for session: ${sessionId}`);

        res.json({
            success: true,
            response,
            sessionId
        });

    } catch (error) {
        console.error(`[${new Date().toISOString()}] Error:`, error.message);

        res.status(500).json({
            success: false,
            error: 'Failed to process message',
            details: error.message,
            sessionId
        });
    }
});

// Reset session endpoint
app.post('/session/reset', authMiddleware, async (req, res) => {
    const { sessionId = 'main' } = req.body;

    try {
        console.log(`[${new Date().toISOString()}] Session reset requested: ${sessionId}`);

        res.json({
            success: true,
            message: `Session '${sessionId}' reset`,
            sessionId
        });

    } catch (error) {
        res.status(500).json({
            success: false,
            error: 'Failed to reset session',
            details: error.message
        });
    }
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error'
    });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║              Clawdbot HTTP Server                             ║
╠═══════════════════════════════════════════════════════════════╣
║  Status:     Running                                          ║
║  Port:       ${PORT.toString().padEnd(48)}║
║  Clawdbot:   ${CLAWDBOT_PATH.substring(0, 45).padEnd(48)}║
║  Auth:       ${(AUTH_TOKEN ? 'Enabled' : 'Disabled').padEnd(48)}║
╠═══════════════════════════════════════════════════════════════╣
║  Endpoints:                                                   ║
║    GET  /health          - Health check                       ║
║    POST /chat            - Send message                       ║
║    POST /session/reset   - Reset session                      ║
╚═══════════════════════════════════════════════════════════════╝
`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down...');
    process.exit(0);
});

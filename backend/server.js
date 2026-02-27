require('dotenv').config();

const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
const { getDatabase, closeDatabase } = require('./database');

// ─────────────────────────────────────────────
// Import Routes
// ─────────────────────────────────────────────
const authRoutes = require('./routes/auth');
const datasetRoutes = require('./routes/dataset');
const chatRoutes = require('./routes/chat');

// ─────────────────────────────────────────────
// Import Middleware
// ─────────────────────────────────────────────
const authMiddleware = require('./middleware/auth');

// ─────────────────────────────────────────────
// Initialize Express App
// ─────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3000;
const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';

// ─────────────────────────────────────────────
// Rate Limiters
// ─────────────────────────────────────────────
const authLimiter = rateLimit({
    windowMs: 60 * 1000,  // 1 minute
    max: 5,               // 5 auth attempts per minute
    message: { error: 'Too many auth attempts — try again in a minute' },
    standardHeaders: true,
    legacyHeaders: false
});

const chatLimiter = rateLimit({
    windowMs: 60 * 1000,  // 1 minute
    max: 10,              // 10 chat requests per minute
    message: { error: 'Too many requests — slow down' },
    standardHeaders: true,
    legacyHeaders: false
});

// ─────────────────────────────────────────────
// Global Middleware
// ─────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────
// Health Check (Public) — DB + Python status
// ─────────────────────────────────────────────
app.get('/api/health', async (req, res) => {
    let dbStatus = 'error';
    let pythonStatus = 'unavailable';

    try {
        const db = getDatabase();
        db.prepare('SELECT 1').get();
        dbStatus = 'connected';
    } catch (e) { /* db down */ }

    try {
        await axios.get(`${PYTHON_SERVICE_URL}/health`, { timeout: 3000 });
        pythonStatus = 'connected';
    } catch (e) {
        pythonStatus = 'unavailable';
    }

    res.json({
        status: dbStatus === 'connected' ? 'ok' : 'degraded',
        database: dbStatus,
        python_service: pythonStatus,
        timestamp: new Date().toISOString()
    });
});

// ─────────────────────────────────────────────
// Public Routes (with rate limiting)
// ─────────────────────────────────────────────
app.use('/api/auth', authLimiter, authRoutes);

// ─────────────────────────────────────────────
// Protected Routes (require JWT + rate limiting on chat)
// ─────────────────────────────────────────────
app.use('/api/upload', authMiddleware, datasetRoutes);
app.use('/api/chat', authMiddleware, chatLimiter, chatRoutes);
app.use('/api/history', authMiddleware, chatRoutes);

// ─────────────────────────────────────────────
// 404 Handler
// ─────────────────────────────────────────────
app.use((req, res) => {
    res.status(404).json({ error: 'Route not found' });
});

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────
const server = app.listen(PORT, () => {
    // Initialize DB on startup
    getDatabase();

    // Pre-warm Python service
    axios.get(`${PYTHON_SERVICE_URL}/health`, { timeout: 3000 }).then(() => {
        console.log('🐍 Python service is ready');
    }).catch(() => {
        console.warn('⚠️  Python service not available yet (start it on port 5000)');
    });

    console.log(`\n🚀 DataWeb Backend running on http://localhost:${PORT}`);
    console.log(`📡 API Endpoints:`);
    console.log(`   POST /api/auth/register   (rate limited)`);
    console.log(`   POST /api/auth/login      (rate limited)`);
    console.log(`   POST /api/upload          (JWT required)`);
    console.log(`   GET  /api/upload/datasets  (JWT required)`);
    console.log(`   POST /api/chat            (JWT + rate limited)`);
    console.log(`   GET  /api/history          (JWT required)`);
    console.log(`   GET  /api/health\n`);
});

// ─────────────────────────────────────────────
// Graceful Shutdown
// ─────────────────────────────────────────────
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down gracefully...');
    closeDatabase();
    server.close(() => process.exit(0));
});

process.on('SIGTERM', () => {
    closeDatabase();
    server.close(() => process.exit(0));
});

module.exports = app;

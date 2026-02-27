const express = require('express');
const axios = require('axios');
const { getDatabase } = require('../database');

const router = express.Router();

const PYTHON_SERVICE_URL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';

// ─────────────────────────────────────────────
// POST /api/chat — Proxy to Python Service + Log Result
// ─────────────────────────────────────────────
router.post('/', async (req, res) => {
    try {
        const { dataset_id, question, context } = req.body;
        const userId = req.user.id;

        if (!dataset_id || !question) {
            return res.status(400).json({ error: 'dataset_id and question are required' });
        }

        // ✅ Input length guard
        if (typeof question !== 'string' || question.trim().length === 0) {
            return res.status(400).json({ error: 'Question must be a non-empty string' });
        }
        if (question.length > 500) {
            return res.status(400).json({ error: 'Question too long — 500 characters max' });
        }

        const db = getDatabase();

        // Fetch dataset — enforcing user isolation
        const dataset = db.prepare(
            'SELECT * FROM datasets WHERE id = ? AND user_id = ?'
        ).get(dataset_id, userId);

        if (!dataset) {
            return res.status(404).json({ error: 'Dataset not found' });
        }

        const schema = JSON.parse(dataset.schema_json);

        // ✅ Schema validation — ensure it has usable columns
        if (!schema || !Array.isArray(schema.columns) || schema.columns.length === 0) {
            return res.status(400).json({ error: 'Dataset has invalid schema — re-upload the CSV' });
        }

        // Call Python AI Service (Port 5000)
        const pythonResponse = await axios.post(
            `${PYTHON_SERVICE_URL}/analyze`,
            {
                file_path: dataset.file_path,
                schema,
                question,
                context: context || []
            },
            { timeout: 10000 } // 10s timeout
        );

        const { answer, data, code, chart_type } = pythonResponse.data;

        // Log to chat_history
        db.prepare(
            'INSERT INTO chat_history (user_id, dataset_id, query, response, code) VALUES (?, ?, ?, ?, ?)'
        ).run(userId, dataset_id, question, answer || '', code || '');

        res.json({
            answer,
            data: data || {},
            code: code || '',
            chart_type: chart_type || null
        });
    } catch (error) {
        // Differentiate timeout vs. other errors
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({ error: 'AI Service Timeout — try again later' });
        }
        if (error.code === 'ECONNREFUSED') {
            return res.status(503).json({ error: 'AI Service Unavailable — Python service is not running' });
        }
        console.error('Chat error:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// ─────────────────────────────────────────────
// GET /api/history — Fetch last 5 chats
// ─────────────────────────────────────────────
router.get('/history', (req, res) => {
    try {
        const userId = req.user.id;
        const datasetId = req.query.dataset_id;

        const db = getDatabase();

        let rows;
        if (datasetId) {
            // History for a specific dataset (user-scoped)
            rows = db.prepare(
                'SELECT ch.id, ch.query, ch.response, ch.code, ch.created_at, d.original_name AS dataset_name FROM chat_history ch JOIN datasets d ON ch.dataset_id = d.id WHERE ch.user_id = ? AND ch.dataset_id = ? ORDER BY ch.created_at DESC LIMIT 5'
            ).all(userId, datasetId);
        } else {
            // All recent history for the user
            rows = db.prepare(
                'SELECT ch.id, ch.query, ch.response, ch.code, ch.created_at, d.original_name AS dataset_name FROM chat_history ch JOIN datasets d ON ch.dataset_id = d.id WHERE ch.user_id = ? ORDER BY ch.created_at DESC LIMIT 5'
            ).all(userId);
        }

        res.json({ history: rows });
    } catch (error) {
        console.error('History error:', error.message);
        res.status(500).json({ error: 'Failed to fetch history' });
    }
});

module.exports = router;

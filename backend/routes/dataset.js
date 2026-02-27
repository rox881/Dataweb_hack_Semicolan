const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { getDatabase } = require('../database');

const router = express.Router();

// ─────────────────────────────────────────────
// Multer Configuration — User-Isolated Storage
// ─────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Isolate uploads per user: /uploads/user_<id>/
        const userDir = path.join(__dirname, '..', 'uploads', `user_${req.user.id}`);
        fs.mkdirSync(userDir, { recursive: true });
        cb(null, userDir);
    },
    filename: (req, file, cb) => {
        // Sanitize filename — strip path traversal characters
        const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
        const uniqueName = `${Date.now()}_${safeName}`;
        cb(null, uniqueName);
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
    fileFilter: (req, file, cb) => {
        // Only allow CSV files
        if (!file.originalname.toLowerCase().endsWith('.csv')) {
            return cb(new Error('Only CSV files are allowed'), false);
        }
        cb(null, true);
    }
});

// ─────────────────────────────────────────────
// Helper — Extract schema (column names) from CSV
// ─────────────────────────────────────────────
function extractSchema(filePath) {
    const firstLine = fs.readFileSync(filePath, 'utf-8').split('\n')[0];
    const columns = firstLine
        .split(',')
        .map(col => col.trim().replace(/^"|"$/g, ''));   // strip quotes
    return { columns };
}

// ─────────────────────────────────────────────
// POST /api/upload — Save CSV + Extract Schema + Save Meta
// ─────────────────────────────────────────────
router.post('/', (req, res) => {
    upload.single('file')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({ error: 'File too large — 10 MB max' });
            }
            return res.status(400).json({ error: err.message });
        }
        if (err) {
            return res.status(400).json({ error: err.message });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        try {
            const userId = req.user.id;
            const filePath = path.resolve(req.file.path);
            const originalName = req.file.originalname;

            // ✅ Path traversal guard — ensure file is within expected directory
            const safeBase = path.resolve(__dirname, '..', 'uploads', `user_${userId}`);
            if (!filePath.startsWith(safeBase)) {
                fs.unlinkSync(filePath); // delete the suspicious file
                return res.status(400).json({ error: 'Invalid file path detected' });
            }

            // Extract column schema from the CSV header
            const schema = extractSchema(filePath);

            // ✅ Schema validation — ensure we got usable columns
            if (!schema.columns || schema.columns.length === 0 || schema.columns[0] === '') {
                return res.status(400).json({ error: 'CSV has no valid column headers' });
            }

            const schemaJson = JSON.stringify(schema);

            // Save metadata to DB
            const db = getDatabase();
            const result = db.prepare(
                'INSERT INTO datasets (user_id, file_path, original_name, schema_json) VALUES (?, ?, ?, ?)'
            ).run(userId, filePath, originalName, schemaJson);

            res.status(201).json({
                message: 'File uploaded successfully',
                dataset: {
                    id: result.lastInsertRowid,
                    original_name: originalName,
                    schema
                }
            });
        } catch (error) {
            console.error('Upload error:', error.message);
            res.status(500).json({ error: 'Failed to process upload' });
        }
    });
});

// ─────────────────────────────────────────────
// GET /api/upload/datasets — List user's datasets
// ─────────────────────────────────────────────
router.get('/datasets', (req, res) => {
    try {
        const db = getDatabase();
        const datasets = db.prepare(
            'SELECT id, original_name, schema_json, uploaded_at FROM datasets WHERE user_id = ? ORDER BY uploaded_at DESC'
        ).all(req.user.id);

        const parsed = datasets.map(d => ({
            ...d,
            schema: JSON.parse(d.schema_json)
        }));

        res.json({ datasets: parsed });
    } catch (error) {
        console.error('List datasets error:', error.message);
        res.status(500).json({ error: 'Failed to fetch datasets' });
    }
});

module.exports = router;

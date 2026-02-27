const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'app.db');
const SCHEMA_PATH = path.join(__dirname, 'init.sql');

let db;

/**
 * Get or create the database connection.
 * Initializes the schema on first call.
 */
function getDatabase() {
    if (db) return db;

    db = new Database(DB_PATH);

    // Enable WAL mode for better concurrent performance
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    // Run schema initialization
    const schema = fs.readFileSync(SCHEMA_PATH, 'utf-8');
    db.exec(schema);

    console.log('✅ SQLite database initialized at', DB_PATH);
    return db;
}

/**
 * Gracefully close the database connection.
 */
function closeDatabase() {
    if (db) {
        db.close();
        db = null;
        console.log('🔒 Database connection closed.');
    }
}

module.exports = { getDatabase, closeDatabase };

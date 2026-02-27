const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
    throw new Error('❌ FATAL: JWT_SECRET is not set in .env — cannot start server');
}

/**
 * Auth Middleware — Verify JWT on every protected route.
 * Extracts user info from the token and attaches it to req.user.
 */
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];

    if (!authHeader) {
        return res.status(401).json({ error: 'Unauthorized — No token provided' });
    }

    // Support "Bearer <token>" format
    const token = authHeader.startsWith('Bearer ')
        ? authHeader.slice(7)
        : authHeader;

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = { id: decoded.id, username: decoded.username };
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Unauthorized — Invalid or expired token' });
    }
}

module.exports = authMiddleware;

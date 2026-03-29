require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ─── Middleware ─────────────────────────────────────────────────────────────────
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
app.use(cookieParser());

// Stricter rate limiter for auth routes — disabled
const authLimiter = (req, res, next) => next();

// ─── Static Files ───────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Routes ─────────────────────────────────────────────────────────────────────
const authRouter = require('./routes/auth');
const marketplaceRouter = require('./routes/marketplace');
const contactRequestRouter = require('./routes/contactRequest');
const servicesRouter = require('./routes/services');

const coursesRouter = require('./routes/courses');
const chatRouter = require('./routes/chat');
const chatRequestsRouter = require('./routes/chatRequests');
const promotionsRouter = require('./routes/promotions');

app.use('/api/auth', authLimiter, authRouter);
app.use('/api/marketplace', marketplaceRouter);
app.use('/api/contact-request', contactRequestRouter);
app.use('/api/services', servicesRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/chat', chatRouter);
app.use('/api/chat-request', chatRequestsRouter);
app.use('/api/promotions', promotionsRouter);
app.use('/api/requests', require('./routes/requests'));
app.use('/api/notifications', require('./routes/notifications').router);

// ─── Catch-all: serve index.html for any unmatched routes ──────────────────────
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Error handler ───────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

// ─── Start ───────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n🎓 MRDU Auth Server running at http://localhost:${PORT}`);
  console.log(`   → Login:           http://localhost:${PORT}/`);
  console.log(`   → OTP Screen:      http://localhost:${PORT}/otp.html`);
  console.log(`   → Dashboard:       http://localhost:${PORT}/dashboard.html`);
  console.log(`\n   Tip: Run 'node db/seed.js' first to populate the database.\n`);
});

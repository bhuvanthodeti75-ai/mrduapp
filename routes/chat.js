const express = require('express');
const { requireAuth, getUserCourseAndSection } = require('./auth');
const { users, messages, chatRequests } = require('../db/database');

const router = express.Router();

// ─── GLOBAL CHAT ──────────────────────────────────────────────────────────────

// POST /api/chat/global
router.post('/global', requireAuth, async (req, res) => {
  try {
    const { message } = req.body;
    if (!message || message.trim() === '') {
      return res.status(400).json({ error: 'Message cannot be empty.' });
    }

    const newMessage = {
      senderRollNumber: req.user.rollNumber,
      message: message.trim(),
      type: 'global',
      createdAt: Date.now()
    };

    const inserted = await messages.insert(newMessage);
    res.status(201).json(inserted);
  } catch (err) {
    console.error('Global chat error:', err);
    res.status(500).json({ error: 'Failed to send global message.' });
  }
});

// GET /api/chat/global
router.get('/global', requireAuth, async (req, res) => {
  try {
    // Get last 50 global messages, sorted by createdAt ASC
    const chatHistory = await messages.find({ type: 'global' })
      .sort({ createdAt: -1 })
      .limit(50);
    
    // Reverse to get ASC (old to new)
    res.json(chatHistory.reverse());
  } catch (err) {
    console.error('Fetch global chat error:', err);
    res.status(500).json({ error: 'Failed to fetch global chat history.' });
  }
});


// ─── PRIVATE CHAT ─────────────────────────────────────────────────────────────

// POST /api/chat/private
router.post('/private', requireAuth, async (req, res) => {
  try {
    const { receiverRollNumber, message } = req.body;
    const senderRollNumber = req.user.rollNumber;

    if (!receiverRollNumber || !message || message.trim() === '') {
      return res.status(400).json({ error: 'Receiver and message are required.' });
    }

    if (senderRollNumber === receiverRollNumber) {
      return res.status(400).json({ error: 'You cannot chat with yourself.' });
    }

    // STRICT CHECK: Check if chat request is accepted
    const request = await chatRequests.findOne({
      status: 'accepted',
      $or: [
        { senderRollNumber, receiverRollNumber },
        { senderRollNumber: receiverRollNumber, receiverRollNumber: senderRollNumber }
      ]
    });

    if (!request) {
      return res.status(403).json({ error: 'Chat access restricted. Request must be accepted first.' });
    }

    const newMessage = {
      senderRollNumber,
      receiverRollNumber,
      message: message.trim(),
      type: 'private',
      createdAt: Date.now()
    };

    const inserted = await messages.insert(newMessage);
    res.status(201).json(inserted);
  } catch (err) {
    console.error('Private chat error:', err);
    res.status(500).json({ error: 'Failed to send private message.' });
  }
});

// GET /api/chat/private/:userId
router.get('/private/:userId', requireAuth, async (req, res) => {
  try {
    const targetUserId = req.params.userId.toUpperCase();
    const myRoll = req.user.rollNumber;

    if (myRoll === targetUserId) {
      return res.status(400).json({ error: 'Cannot fetch history with yourself.' });
    }

    // STRICT CHECK: Check if chat request is accepted
    const request = await chatRequests.findOne({
      status: 'accepted',
      $or: [
        { senderRollNumber: myRoll, receiverRollNumber: targetUserId },
        { senderRollNumber: targetUserId, receiverRollNumber: myRoll }
      ]
    });

    if (!request) {
      return res.status(403).json({ error: 'Chat access restricted. Request must be accepted first.' });
    }

    const chatHistory = await messages.find({
      type: 'private',
      $or: [
        { senderRollNumber: myRoll, receiverRollNumber: targetUserId },
        { senderRollNumber: targetUserId, receiverRollNumber: myRoll }
      ]
    }).sort({ createdAt: 1 });

    res.json(chatHistory);
  } catch (err) {
    console.error('Fetch private chat error:', err);
    res.status(500).json({ error: 'Failed to fetch private chat history.' });
  }
});


module.exports = router;

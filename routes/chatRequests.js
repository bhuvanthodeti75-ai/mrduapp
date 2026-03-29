const express = require('express');
const { chatRequests, users } = require('../db/database');
const { requireAuth } = require('./auth');
const { createNotification } = require('./notifications');

const router = express.Router();

// ─── CHAT REQUESTS ────────────────────────────────────────────────────────────

// POST /api/chat-request
router.post('/', requireAuth, async (req, res) => {
  try {
    const { receiverRollNumber } = req.body;
    const senderRollNumber = req.user.rollNumber;

    if (!receiverRollNumber) {
      return res.status(400).json({ error: 'Receiver roll number is required.' });
    }

    const targetRoll = receiverRollNumber.trim().toUpperCase();

    if (senderRollNumber === targetRoll) {
      return res.status(400).json({ error: 'You cannot send a chat request to yourself.' });
    }

    // Check if target user exists
    const targetUser = await users.findOne({ rollNumber: targetRoll });
    if (!targetUser) {
      return res.status(404).json({ error: 'Recipient user not found.' });
    }

    // Check for existing request (any status)
    const existingRequest = await chatRequests.findOne({
      $or: [
        { senderRollNumber, receiverRollNumber: targetRoll },
        { senderRollNumber: targetRoll, receiverRollNumber: senderRollNumber }
      ]
    });

    if (existingRequest) {
      if (existingRequest.status === 'accepted') {
        return res.status(400).json({ error: 'You are already connected.' });
      }
      return res.status(400).json({ error: 'A request is already pending or exists.' });
    }

    const newRequest = {
      senderRollNumber,
      receiverRollNumber: targetRoll,
      status: 'pending',
      createdAt: Date.now()
    };

    const inserted = await chatRequests.insert(newRequest);

    // Notify receiver
    createNotification(
      targetRoll, 
      'chat_request', 
      `You have a new private chat request from ${senderRollNumber}.`,
      `/private-chat.html`
    ).catch(err => console.error("Error notifying receiver of chat request:", err));

    res.status(201).json(inserted);
  } catch (err) {
    console.error('Chat request error:', err);
    res.status(500).json({ error: 'Failed to send chat request.' });
  }
});

// GET /api/chat-request/all-accepted
router.get('/all-accepted', requireAuth, async (req, res) => {
  try {
    const myRoll = req.user.rollNumber;
    const requests = await chatRequests.find({
      status: 'accepted',
      $or: [
        { senderRollNumber: myRoll },
        { receiverRollNumber: myRoll }
      ]
    }).sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    console.error('Fetch accepted requests error:', err);
    res.status(500).json({ error: 'Failed to fetch accepted requests.' });
  }
});

// GET /api/chat-request/my
router.get('/my', requireAuth, async (req, res) => {
  try {
    const myRoll = req.user.rollNumber;
    // Get requests where I am the receiver
    const requests = await chatRequests.find({ receiverRollNumber: myRoll }).sort({ createdAt: -1 });
    res.json(requests);
  } catch (err) {
    console.error('Fetch requests error:', err);
    res.status(500).json({ error: 'Failed to fetch incoming requests.' });
  }
});

// GET /api/chat-request/status/:userId
router.get('/status/:userId', requireAuth, async (req, res) => {
  try {
    const myRoll = req.user.rollNumber;
    const targetRoll = req.params.userId.toUpperCase();

    const request = await chatRequests.findOne({
      $or: [
        { senderRollNumber: myRoll, receiverRollNumber: targetRoll },
        { senderRollNumber: targetRoll, receiverRollNumber: myRoll }
      ]
    });

    if (!request) {
      return res.json({ status: 'no_request' });
    }

    res.json({ status: request.status, request });
  } catch (err) {
    console.error('Fetch status error:', err);
    res.status(500).json({ error: 'Failed to fetch status.' });
  }
});

// PATCH /api/chat-request/:id
router.patch('/:id', requireAuth, async (req, res) => {
  try {
    const { status } = req.body; // "accepted" or "rejected"
    const requestId = req.params.id;
    const myRoll = req.user.rollNumber;

    if (!['accepted', 'rejected'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status. Use "accepted" or "rejected".' });
    }

    const request = await chatRequests.findOne({ _id: requestId });
    if (!request) {
      return res.status(404).json({ error: 'Request not found.' });
    }

    // Only the receiver can update the request
    if (request.receiverRollNumber !== myRoll) {
      return res.status(403).json({ error: 'Only the recipient can respond to this request.' });
    }

    await chatRequests.update({ _id: requestId }, { $set: { status } });

    if (status === 'accepted') {
      // Notify sender that their request was accepted
      createNotification(
        request.senderRollNumber,
        'chat_accepted',
        `${myRoll} accepted your chat request!`,
        `/private-chat.html?roll=${myRoll}`
      ).catch(err => console.error("Error notifying sender of chat acceptance:", err));
    } else if (status === 'rejected') {
      // Notify sender that their request was rejected
      createNotification(
        request.senderRollNumber,
        'chat_rejected',
        `${myRoll} declined your chat request.`,
        `#`
      ).catch(err => console.error("Error notifying sender of chat rejection:", err));
    }

    res.json({ message: `Request ${status} successfully.` });
  } catch (err) {
    console.error('Update request error:', err);
    res.status(500).json({ error: 'Failed to update request.' });
  }
});

module.exports = router;

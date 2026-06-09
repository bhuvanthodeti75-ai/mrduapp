const express = require('express');
const { requireAuth } = require('./auth');
const router = express.Router();
const { users, requests } = require('../db/database');
const { createNotification } = require('./notifications');

// GET /api/requests - all active, unresolved, not expired
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search } = req.query;

    // 14 days auto-expiry
    const EXPIRY_TIME = 14 * 24 * 60 * 60 * 1000;
    const now = Date.now();

    let list = await requests.find({ isActive: true, isResolved: false }).sort({ createdAt: -1 });

    // Filter out expired items
    list = list.filter(r => (now - r.createdAt) < EXPIRY_TIME);

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r => 
        (r.title && r.title.toLowerCase().includes(q)) || 
        (r.description && r.description.toLowerCase().includes(q))
      );
    }

    res.json(list);
  } catch (err) {
    console.error('Error fetching requests:', err.message);
    res.status(500).json({ error: 'Failed to retrieve item requests.' });
  }
});

// GET /api/requests/my
router.get('/my', requireAuth, async (req, res) => {
  try {
    const myRequests = await requests.find({ requestedBy: req.user.rollNumber, isActive: true }).sort({ createdAt: -1 });
    res.json(myRequests);
  } catch (err) {
    console.error('Error listing my requests:', err.message);
    res.status(500).json({ error: 'Failed to retrieve your item requests.' });
  }
});

// POST /api/requests
router.post('/', requireAuth, async (req, res) => {
  const { title, description, contact, requireApproval } = req.body;

  if (!title || !description || !contact) {
    return res.status(400).json({ error: 'Title, description, and contact are required.' });
  }

  // 10 digit validation
  if (!/^\d{10}$/.test(contact)) {
    return res.status(400).json({ error: 'Contact number must be exactly 10 digits.' });
  }

  try {
    const newReq = {
      id: Date.now().toString(),
      title,
      description,
      contact,
      requireApproval: !!requireApproval,
      requestedBy: req.user.rollNumber,
      createdAt: Date.now(),
      isActive: true,
      isResolved: false
    };

    await requests.insert(newReq);

    createNotification(
      req.user.rollNumber,
      'feed_post',
      `You posted the item request "${title}".`,
      `/requests.html`
    ).catch(err => console.error("Error creating request notification:", err));

    // Broadcast to all other users
    users.find({}).then(allUsers => {
      const broadcastPromises = allUsers
        .filter(u => u.rollNumber !== req.user.rollNumber)
        .map(u => createNotification(
          u.rollNumber,
          'feed_post',
          `${req.user.rollNumber} is looking for: ${title}`,
          '/requests.html'
        ));
      
      Promise.all(broadcastPromises).catch(err => console.error("Error in parallel request broadcast:", err));
    }).catch(err => console.error("Error broadcasting item request notification:", err));

    res.status(201).json(newReq);
  } catch (err) {
    console.error('Error creating request:', err.message);
    res.status(500).json({ error: 'Failed to post item request.' });
  }
});

// PATCH /api/requests/:id/resolve
router.patch('/:id/resolve', requireAuth, async (req, res) => {
  try {
    const request = await requests.findOne({ id: req.params.id });

    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.requestedBy !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const nextResolved = !request.isResolved;
    await requests.update({ id: req.params.id }, { isResolved: nextResolved });

    const updated = { ...request, isResolved: nextResolved };
    res.json(updated);
  } catch (err) {
    console.error('Error resolving request:', err.message);
    res.status(500).json({ error: 'Failed to update request state.' });
  }
});

// DELETE /api/requests/:id
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const request = await requests.findOne({ id: req.params.id });

    if (!request) return res.status(404).json({ error: 'Request not found.' });
    if (request.requestedBy !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    await requests.update({ id: req.params.id }, { isActive: false }); // Soft delete
    res.json({ message: 'Deleted successfully' });
  } catch (err) {
    console.error('Error deleting request:', err.message);
    res.status(500).json({ error: 'Failed to delete request.' });
  }
});

module.exports = router;

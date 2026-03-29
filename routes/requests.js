const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('./auth');
const router = express.Router();
const { users } = require('../db/database');
const { createNotification } = require('./notifications');

const REQUESTS_FILE = path.join(__dirname, '..', 'requests.json');

function readRequests() {
  try {
    if (!fs.existsSync(REQUESTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(REQUESTS_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

function writeRequests(items) {
  fs.writeFileSync(REQUESTS_FILE, JSON.stringify(items, null, 2));
}

// GET /api/requests - all active, unresolved, not expired
router.get('/', requireAuth, (req, res) => {
  let requests = readRequests();
  const { search } = req.query;

  // 14 days auto-expiry
  const EXPIRY_TIME = 14 * 24 * 60 * 60 * 1000;
  const now = Date.now();

  requests = requests.filter(r => 
    r.isActive !== false && 
    r.isResolved !== true &&
    (now - r.createdAt) < EXPIRY_TIME
  );

  if (search) {
    const q = search.toLowerCase();
    requests = requests.filter(r => 
      r.title.toLowerCase().includes(q) || 
      r.description.toLowerCase().includes(q)
    );
  }

  requests.sort((a, b) => b.createdAt - a.createdAt);
  res.json(requests);
});

// GET /api/requests/my
router.get('/my', requireAuth, (req, res) => {
  const requests = readRequests();
  const myRequests = requests.filter(r => r.requestedBy === req.user.rollNumber && r.isActive !== false);
  myRequests.sort((a, b) => b.createdAt - a.createdAt);
  res.json(myRequests);
});

// POST /api/requests
router.post('/', requireAuth, (req, res) => {
  const { title, description, contact, requireApproval } = req.body;

  if (!title || !description || !contact) {
    return res.status(400).json({ error: 'Title, description, and contact are required.' });
  }

  // 10 digit validation
  if (!/^\d{10}$/.test(contact)) {
    return res.status(400).json({ error: 'Contact number must be exactly 10 digits.' });
  }

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

  const requests = readRequests();
  requests.push(newReq);
  writeRequests(requests);

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
});

// PATCH /api/requests/:id/resolve
router.patch('/:id/resolve', requireAuth, (req, res) => {
  const requests = readRequests();
  const index = requests.findIndex(r => r.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: 'Request not found.' });
  if (requests[index].requestedBy !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized.' });
  }

  // Toggle resolved state
  requests[index].isResolved = !requests[index].isResolved;
  writeRequests(requests);

  res.json(requests[index]);
});

// DELETE /api/requests/:id
router.delete('/:id', requireAuth, (req, res) => {
  const requests = readRequests();
  const index = requests.findIndex(r => r.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: 'Request not found.' });
  if (requests[index].requestedBy !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized.' });
  }

  requests[index].isActive = false; // Soft delete
  writeRequests(requests);

  res.json({ message: 'Deleted successfully' });
});

module.exports = router;

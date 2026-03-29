const express = require('express');
const { requireAuth } = require('./auth');
const router = express.Router();
const { notifications } = require('../db/database');
const fs = require('fs');
const path = require('path');

const OLD_NOTIFICATIONS_FILE = path.join(__dirname, '..', 'notifications.json');

// Migration: Move data from JSON to NeDB if JSON exists
async function migrateFromJSON() {
  try {
    if (fs.existsSync(OLD_NOTIFICATIONS_FILE)) {
      const data = JSON.parse(fs.readFileSync(OLD_NOTIFICATIONS_FILE, 'utf-8'));
      if (Array.isArray(data) && data.length > 0) {
        console.log(`Migrating ${data.length} notifications to NeDB...`);
        // Remove IDs if they conflict or just insert
        for (const n of data) {
          // Check if already exists to avoid dupes on restart
          const exists = await notifications.findOne({ id: n.id });
          if (!exists) {
            await notifications.insert(n);
          }
        }
        console.log('Migration complete.');
        // Rename file to avoid re-migration
        fs.renameSync(OLD_NOTIFICATIONS_FILE, OLD_NOTIFICATIONS_FILE + '.bak');
      }
    }
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

migrateFromJSON();

// Reusable Helper to create a notification directly from other backend modules
const createNotification = async (userRollNumber, type, message, link) => {
  const newNotif = {
    id: Date.now().toString() + '-' + Math.floor(Math.random() * 10000),
    userRollNumber,
    type,
    message,
    link: link || '#',
    isRead: false,
    createdAt: Date.now()
  };
  return await notifications.insert(newNotif);
};

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/notifications - Return user's notifications
// ════════════════════════════════════════════════════════════════════════════════
router.get('/', requireAuth, async (req, res) => {
  try {
    const myNotifs = await notifications.find({ userRollNumber: req.user.rollNumber }).sort({ createdAt: -1 });
    res.json(myNotifs);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/notifications/unread-count
// ════════════════════════════════════════════════════════════════════════════════
router.get('/unread-count', requireAuth, async (req, res) => {
  try {
    const count = await notifications.count({ userRollNumber: req.user.rollNumber, isRead: false });
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/notifications/:id/read - Mark notification as read
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id/read', requireAuth, async (req, res) => {
  try {
    const updated = await notifications.update(
      { id: req.params.id, userRollNumber: req.user.rollNumber },
      { $set: { isRead: true } },
      { returnUpdatedDocs: true }
    );
    if (!updated) return res.status(404).json({ error: 'Notification not found' });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/notifications/:id - Optional delete
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const numRemoved = await notifications.remove({ id: req.params.id, userRollNumber: req.user.rollNumber });
    if (numRemoved === 0) return res.status(404).json({ error: 'Notification not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

module.exports = {
  router,
  createNotification
};

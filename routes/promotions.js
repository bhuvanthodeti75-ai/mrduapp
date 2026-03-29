const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('./auth');
const router = express.Router();
const multer = require('multer');
const { users } = require('../db/database');
const { createNotification } = require('./notifications');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images are allowed!'), false);
  }
});

const PROMOTIONS_FILE = path.join(__dirname, '..', 'promotions.json');

function readPromotions() {
  try {
    if (!fs.existsSync(PROMOTIONS_FILE)) return [];
    const data = fs.readFileSync(PROMOTIONS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading promotions.json:', err);
    return [];
  }
}

function writePromotions(items) {
  try {
    fs.writeFileSync(PROMOTIONS_FILE, JSON.stringify(items, null, 2));
  } catch (err) {
    console.error('Error writing promotions.json:', err);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/promotions - List all posts
// ════════════════════════════════════════════════════════════════════════════════
router.get('/', requireAuth, (req, res) => {
  let items = readPromotions();
  
  // Sort latest first
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json(items);
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/promotions - Add new post
// ════════════════════════════════════════════════════════════════════════════════
router.post('/', requireAuth, upload.single('image'), (req, res) => {
  const { title, description, eventDate, contact } = req.body;
  const imageFile = req.file;

  if (!title || !description || title.trim() === '' || description.trim() === '') {
    return res.status(400).json({ error: 'Title and description are required to post.' });
  }

  const items = readPromotions();
  const newItem = {
    id: Date.now().toString(),
    title: title.trim(),
    description: description.trim(),
    contact: contact ? contact.trim() : '',
    eventDate: eventDate || '',
    image: imageFile ? `/uploads/${imageFile.filename}` : '',
    createdBy: req.user.rollNumber,
    createdAt: Date.now()
  };

  items.push(newItem);
  writePromotions(items);

  // Notify all users except creator
  users.find({}).then(allUsers => {
    const broadcastPromises = allUsers
      .filter(u => u.rollNumber !== req.user.rollNumber)
      .map(u => createNotification(
        u.rollNumber,
        'feed_post',
        `${req.user.rollNumber} posted a new Campus Announcement: ${title.substring(0, 30)}...`,
        '/dashboard.html'
      ));
    
    Promise.all(broadcastPromises).catch(err => console.error("Error in parallel promotion broadcast:", err));
  }).catch(err => console.error("Error broadcasting notifications:", err));

  res.status(201).json(newItem);
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/promotions/:id - Get single post
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:id', requireAuth, (req, res) => {
  const items = readPromotions();
  const post = items.find(item => item.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'Post not found.' });
  res.json(post);
});

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/promotions/:id
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, (req, res) => {
  const items = readPromotions();
  const index = items.findIndex(item => item.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: 'Post not found.' });

  // Ownership check
  if (items[index].createdBy !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized. Only the creator can delete this post.' });
  }

  items.splice(index, 1);
  writePromotions(items);

  res.json({ message: 'Post deleted successfully.' });
});

// ════════════════════════════════════════════════════════════════════════════════
// PUT /api/promotions/:id - Update post
// ════════════════════════════════════════════════════════════════════════════════
router.put('/:id', requireAuth, upload.single('image'), (req, res) => {
  const { title, description, eventDate, contact } = req.body;
  const imageFile = req.file;

  const items = readPromotions();
  const index = items.findIndex(item => item.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: 'Post not found.' });

  // Ownership check
  if (items[index].createdBy !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized. Only the creator can edit this post.' });
  }

  if (title) items[index].title = title.trim();
  if (description) items[index].description = description.trim();
  if (contact !== undefined) items[index].contact = contact.trim();
  if (eventDate !== undefined) items[index].eventDate = eventDate;
  if (imageFile) items[index].image = `/uploads/${imageFile.filename}`;

  writePromotions(items);

  res.json(items[index]);
});

module.exports = router;

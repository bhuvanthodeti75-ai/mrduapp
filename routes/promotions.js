const express = require('express');
const path = require('path');
const { requireAuth } = require('./auth');
const router = express.Router();
const multer = require('multer');
const { users, promotions, uploadToSupabaseStorage } = require('../db/database');
const { createNotification } = require('./notifications');

// Configure Multer memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images are allowed!'), false);
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/promotions - List all posts
// ════════════════════════════════════════════════════════════════════════════════
router.get('/', requireAuth, async (req, res) => {
  try {
    const items = await promotions.find({}).sort({ createdAt: -1 });
    res.json(items);
  } catch (err) {
    console.error('Error fetching promotions:', err.message);
    res.status(500).json({ error: 'Failed to retrieve announcements.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/promotions - Add new post
// ════════════════════════════════════════════════════════════════════════════════
router.post('/', requireAuth, upload.single('image'), async (req, res) => {
  const { title, description, eventDate, contact } = req.body;
  const imageFile = req.file;

  if (!title || !description || title.trim() === '' || description.trim() === '') {
    return res.status(400).json({ error: 'Title and description are required to post.' });
  }

  try {
    let imageUrl = '';
    if (imageFile) {
      const filename = `promotion-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(imageFile.originalname)}`;
      imageUrl = await uploadToSupabaseStorage(imageFile.buffer, filename, imageFile.mimetype);
    }

    const newItem = {
      id: Date.now().toString(),
      title: title.trim(),
      description: description.trim(),
      contact: contact ? contact.trim() : '',
      eventDate: eventDate || '',
      image: imageUrl,
      createdBy: req.user.rollNumber,
      createdAt: Date.now()
    };

    await promotions.insert(newItem);

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
  } catch (err) {
    console.error('Error creating promotion:', err.message);
    res.status(500).json({ error: 'Failed to post announcement.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/promotions/:id - Get single post
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const post = await promotions.findOne({ id: req.params.id });
    if (!post) return res.status(404).json({ error: 'Post not found.' });
    res.json(post);
  } catch (err) {
    console.error('Error fetching promotion:', err.message);
    res.status(500).json({ error: 'Failed to retrieve announcement details.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/promotions/:id
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const post = await promotions.findOne({ id: req.params.id });

    if (!post) return res.status(404).json({ error: 'Post not found.' });

    // Ownership check
    if (post.createdBy !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized. Only the creator can delete this post.' });
    }

    await promotions.remove({ id: req.params.id });
    res.json({ message: 'Post deleted successfully.' });
  } catch (err) {
    console.error('Error deleting promotion:', err.message);
    res.status(500).json({ error: 'Failed to delete announcement.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// PUT /api/promotions/:id - Update post
// ════════════════════════════════════════════════════════════════════════════════
router.put('/:id', requireAuth, upload.single('image'), async (req, res) => {
  const { title, description, eventDate, contact } = req.body;
  const imageFile = req.file;

  try {
    const post = await promotions.findOne({ id: req.params.id });

    if (!post) return res.status(404).json({ error: 'Post not found.' });

    // Ownership check
    if (post.createdBy !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized. Only the creator can edit this post.' });
    }

    let imageUrl = post.image;
    if (imageFile) {
      const filename = `promotion-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(imageFile.originalname)}`;
      imageUrl = await uploadToSupabaseStorage(imageFile.buffer, filename, imageFile.mimetype);
    }

    const updates = {};
    if (title) updates.title = title.trim();
    if (description) updates.description = description.trim();
    if (contact !== undefined) updates.contact = contact.trim();
    if (eventDate !== undefined) updates.eventDate = eventDate;
    updates.image = imageUrl;

    await promotions.update({ id: req.params.id }, updates);

    const updatedPost = { ...post, ...updates };
    res.json(updatedPost);
  } catch (err) {
    console.error('Error updating promotion:', err.message);
    res.status(500).json({ error: 'Failed to update announcement.' });
  }
});

module.exports = router;

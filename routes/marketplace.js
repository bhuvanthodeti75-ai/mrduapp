const express = require('express');
const path = require('path');
const { requireAuth } = require('./auth');
const router = express.Router();
const multer = require('multer');
const { users, marketplace, uploadToSupabaseStorage } = require('../db/database');
const { createNotification } = require('./notifications');

// Configure Multer memory storage
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images are allowed!'), false);
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/marketplace - List all available items
// ════════════════════════════════════════════════════════════════════════════════
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search, category, type } = req.query;
    
    // We fetch all available items first
    let items = await marketplace.find({ isAvailable: true }).sort({ createdAt: -1 });

    // Privacy: Remove contact info from general listing
    items = items.map(item => {
      const { contact, ...rest } = item;
      return rest;
    });

    if (search) {
      const q = search.toLowerCase();
      items = items.filter(item => 
        (item.title && item.title.toLowerCase().includes(q)) || 
        (item.description && item.description.toLowerCase().includes(q))
      );
    }

    if (category && category !== 'All') {
      items = items.filter(item => item.category === category);
    }

    if (type && type !== 'All') {
      items = items.filter(item => item.type === type);
    }

    res.json(items);
  } catch (err) {
    console.error('Error listing marketplace items:', err.message);
    res.status(500).json({ error: 'Failed to retrieve marketplace items.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/marketplace/my - List current user's items
// ════════════════════════════════════════════════════════════════════════════════
router.get('/my', requireAuth, async (req, res) => {
  try {
    const myItems = await marketplace.find({ sellerRollNumber: req.user.rollNumber }).sort({ createdAt: -1 });
    res.json(myItems);
  } catch (err) {
    console.error('Error listing user marketplace items:', err.message);
    res.status(500).json({ error: 'Failed to retrieve your marketplace items.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/marketplace/:id - Get single item
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const item = await marketplace.findOne({ id: req.params.id });
    if (!item) return res.status(404).json({ error: 'Item not found.' });
    res.json(item);
  } catch (err) {
    console.error('Error fetching marketplace item:', err.message);
    res.status(500).json({ error: 'Failed to retrieve marketplace item details.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/marketplace - Add new item
// ════════════════════════════════════════════════════════════════════════════════
router.post('/', requireAuth, upload.single('image'), async (req, res) => {
  const { title, category, price, type, description, contact } = req.body;
  const imageFile = req.file;

  if (!title || !category || !price || !type || !contact) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  try {
    let imageUrl = '';
    if (imageFile) {
      const filename = `marketplace-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(imageFile.originalname)}`;
      imageUrl = await uploadToSupabaseStorage(imageFile.buffer, filename, imageFile.mimetype);
    }

    const newItem = {
      id: Date.now().toString(),
      title,
      category,
      price: parseFloat(price),
      type,
      description: description || '',
      image: imageUrl,
      sellerRollNumber: req.user.rollNumber,
      contact,
      isAvailable: true,
      createdAt: Date.now()
    };

    await marketplace.insert(newItem);

    createNotification(
      req.user.rollNumber,
      'feed_post',
      `You posted "${title}" in the Marketplace.`,
      `/marketplace.html`
    ).catch(err => console.error("Error creating personal notification:", err));

    // Broadcast to all other users
    users.find({}).then(allUsers => {
      const broadcastPromises = allUsers
        .filter(u => u.rollNumber !== req.user.rollNumber)
        .map(u => createNotification(
          u.rollNumber,
          'feed_post',
          `${req.user.rollNumber} listed a new item: ${title}`,
          '/marketplace.html'
        ));
      
      Promise.all(broadcastPromises).catch(err => console.error("Error in parallel broadcast:", err));
    }).catch(err => console.error("Error broadcasting marketplace notification:", err));

    res.status(201).json(newItem);
  } catch (err) {
    console.error('Error creating marketplace item:', err.message);
    res.status(500).json({ error: 'Failed to create marketplace item.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/marketplace/:id/toggle-availability
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id/toggle-availability', requireAuth, async (req, res) => {
  try {
    const item = await marketplace.findOne({ id: req.params.id });

    if (!item) return res.status(404).json({ error: 'Item not found.' });
    
    // Ownership check
    if (item.sellerRollNumber !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized. Only the owner can change availability.' });
    }

    const nextAvailable = !item.isAvailable;
    await marketplace.update({ id: req.params.id }, { isAvailable: nextAvailable });

    const updated = { ...item, isAvailable: nextAvailable };
    res.json(updated);
  } catch (err) {
    console.error('Error toggling availability:', err.message);
    res.status(500).json({ error: 'Failed to update item availability.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/marketplace/:id
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const item = await marketplace.findOne({ id: req.params.id });

    if (!item) return res.status(404).json({ error: 'Item not found.' });

    // Ownership check
    if (item.sellerRollNumber !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized. Only the owner can delete this item.' });
    }

    await marketplace.remove({ id: req.params.id });
    res.json({ message: 'Item deleted successfully.' });
  } catch (err) {
    console.error('Error deleting marketplace item:', err.message);
    res.status(500).json({ error: 'Failed to delete marketplace item.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/marketplace/:id - Update item details
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id', requireAuth, upload.single('image'), async (req, res) => {
  const { title, category, price, type, description, contact } = req.body;
  const imageFile = req.file;

  try {
    const item = await marketplace.findOne({ id: req.params.id });

    if (!item) return res.status(404).json({ error: 'Item not found.' });

    // Ownership check
    if (item.sellerRollNumber !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    let imageUrl = item.image;
    if (imageFile) {
      const filename = `marketplace-${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(imageFile.originalname)}`;
      imageUrl = await uploadToSupabaseStorage(imageFile.buffer, filename, imageFile.mimetype);
    }

    const updates = {};
    if (title) updates.title = title;
    if (category) updates.category = category;
    if (price) updates.price = parseFloat(price);
    if (type) updates.type = type;
    if (description !== undefined) updates.description = description;
    if (contact) updates.contact = contact;
    updates.image = imageUrl;

    await marketplace.update({ id: req.params.id }, updates);

    const updatedItem = { ...item, ...updates };
    res.json(updatedItem);
  } catch (err) {
    console.error('Error updating marketplace item:', err.message);
    res.status(500).json({ error: 'Failed to update marketplace item.' });
  }
});

module.exports = router;

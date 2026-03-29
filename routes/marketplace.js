const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('./auth');
const router = express.Router();
const multer = require('multer');
const { users } = require('../db/database');
const { createNotification } = require('./notifications');

// Configure Multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only images are allowed!'), false);
  }
});


const MARKETPLACE_FILE = path.join(__dirname, '..', 'marketplace.json');

// Helper to read marketplace data
function readMarketplace() {
  try {
    if (!fs.existsSync(MARKETPLACE_FILE)) return [];
    const data = fs.readFileSync(MARKETPLACE_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error('Error reading marketplace.json:', err);
    return [];
  }
}

// Helper to write marketplace data
function writeMarketplace(items) {
  try {
    fs.writeFileSync(MARKETPLACE_FILE, JSON.stringify(items, null, 2));
  } catch (err) {
    console.error('Error writing marketplace.json:', err);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/marketplace - List all available items
// ════════════════════════════════════════════════════════════════════════════════
router.get('/', requireAuth, (req, res) => {
  let items = readMarketplace();
  
  // Only show available items for the general feed
  items = items.filter(item => item.isAvailable !== false);

  // Privacy: Remove contact info from general listing
  items = items.map(item => {
    const { contact, ...rest } = item;
    return rest;
  });

  const { search, category, type } = req.query;

  if (search) {
    const q = search.toLowerCase();
    items = items.filter(item => item.title.toLowerCase().includes(q) || item.description.toLowerCase().includes(q));
  }

  if (category && category !== 'All') {
    items = items.filter(item => item.category === category);
  }

  if (type && type !== 'All') {
    items = items.filter(item => item.type === type);
  }

  // Sort by latest first
  items.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  res.json(items);
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/marketplace/:id - Get single item
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:id', requireAuth, (req, res) => {
  const items = readMarketplace();
  const item = items.find(i => i.id === req.params.id);
  if (!item) return res.status(404).json({ error: 'Item not found.' });
  res.json(item);
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/marketplace/my - List current user's items
// ════════════════════════════════════════════════════════════════════════════════
router.get('/my', requireAuth, (req, res) => {
  const items = readMarketplace();
  const myItems = items.filter(item => item.sellerRollNumber === req.user.rollNumber);
  myItems.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json(myItems);
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/marketplace - Add new item
// ════════════════════════════════════════════════════════════════════════════════
router.post('/', requireAuth, upload.single('image'), (req, res) => {
  const { title, category, price, type, description, contact } = req.body;
  const imageFile = req.file;

  if (!title || !category || !price || !type || !contact) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const items = readMarketplace();
  const newItem = {
    id: Date.now().toString(),
    title,
    category,
    price: parseFloat(price),
    type,
    description,
    image: imageFile ? `/uploads/${imageFile.filename}` : '',
    sellerRollNumber: req.user.rollNumber,
    contact,
    isAvailable: true,
    createdAt: Date.now()
  };

  items.push(newItem);
  writeMarketplace(items);

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
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/marketplace/:id/toggle-availability
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id/toggle-availability', requireAuth, (req, res) => {
  const items = readMarketplace();
  const index = items.findIndex(item => item.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: 'Item not found.' });
  
  // Ownership check
  if (items[index].sellerRollNumber !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized. Only the owner can change availability.' });
  }

  items[index].isAvailable = !items[index].isAvailable;
  writeMarketplace(items);

  res.json(items[index]);
});

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/marketplace/:id
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, (req, res) => {
  const items = readMarketplace();
  const index = items.findIndex(item => item.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: 'Item not found.' });

  // Ownership check
  if (items[index].sellerRollNumber !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized. Only the owner can delete this item.' });
  }

  items.splice(index, 1);
  writeMarketplace(items);

  res.json({ message: 'Item deleted successfully.' });
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/marketplace/:id - Update item details
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id', requireAuth, upload.single('image'), (req, res) => {
  const { title, category, price, type, description, contact } = req.body;
  const imageFile = req.file;

  const items = readMarketplace();
  const index = items.findIndex(item => item.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: 'Item not found.' });

  // Ownership check
  if (items[index].sellerRollNumber !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized.' });
  }

  // Update fields
  if (title) items[index].title = title;
  if (category) items[index].category = category;
  if (price) items[index].price = parseFloat(price);
  if (type) items[index].type = type;
  if (description !== undefined) items[index].description = description;
  if (contact) items[index].contact = contact;
  if (imageFile) items[index].image = `/uploads/${imageFile.filename}`;

  writeMarketplace(items);
  res.json(items[index]);
});

module.exports = router;

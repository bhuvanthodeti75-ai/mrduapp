const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('./auth');
const router = express.Router();
const { users } = require('../db/database');
const { createNotification } = require('./notifications');

const SERVICES_FILE = path.join(__dirname, '..', 'services.json');

// Helper to read/write services
function readServices() {
  try {
    if (!fs.existsSync(SERVICES_FILE)) return [];
    return JSON.parse(fs.readFileSync(SERVICES_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

function writeServices(services) {
  fs.writeFileSync(SERVICES_FILE, JSON.stringify(services, null, 2));
}

const VALID_CATEGORIES = ['Assignment', 'Lab Record', 'PPT', 'Notes', 'Project'];

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/services - Add new service
// ════════════════════════════════════════════════════════════════════════════════
router.post('/', requireAuth, (req, res) => {
  const { title, description, price, category, contact } = req.body;
  const providerRollNumber = req.user.rollNumber;

  // Validation
  if (!title || !description || !price || !category || !contact) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  if (!VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'Invalid category.' });
  }

  const numericPrice = parseFloat(price);
  if (isNaN(numericPrice) || numericPrice <= 0) {
    return res.status(400).json({ error: 'Price must be a positive number.' });
  }

  const services = readServices();
  const newService = {
    id: Date.now().toString(),
    title,
    description,
    price: numericPrice,
    category,
    providerRollNumber,
    contact,
    isAvailable: true,
    createdAt: Date.now()
  };

  services.push(newService);
  writeServices(services);

  createNotification(
    req.user.rollNumber,
    'feed_post',
    `You created the service "${title}".`,
    `/services.html`
  );

  // Broadcast to all other users
  users.find({}).then(allUsers => {
    const broadcastPromises = allUsers
      .filter(u => u.rollNumber !== req.user.rollNumber)
      .map(u => createNotification(
        u.rollNumber,
        'feed_post',
        `${req.user.rollNumber} offered a new service: ${title}`,
        '/services.html'
      ));
    
    Promise.all(broadcastPromises).catch(err => console.error("Error in parallel service broadcast:", err));
  }).catch(err => console.error("Error broadcasting service notification:", err));

  res.status(201).json(newService);
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/services - List all available services
// ════════════════════════════════════════════════════════════════════════════════
router.get('/', requireAuth, (req, res) => {
  let services = readServices();

  // Only show available services for the general feed
  services = services.filter(s => s.isAvailable === true);

  // Privacy: Remove contact info from general listing
  services = services.map(s => {
    const { contact, ...rest } = s;
    return rest;
  });

  const { search, category } = req.query;

  if (search) {
    const q = search.toLowerCase();
    services = services.filter(s => 
      s.title.toLowerCase().includes(q) || 
      s.description.toLowerCase().includes(q)
    );
  }

  if (category && category !== 'All') {
    services = services.filter(s => s.category === category);
  }

  // Sort by latest
  services.sort((a, b) => b.createdAt - a.createdAt);

  res.json(services);
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/services/:id - Get single service
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:id', requireAuth, (req, res) => {
  const services = readServices();
  const service = services.find(s => s.id === req.params.id);
  if (!service) return res.status(404).json({ error: 'Service not found.' });
  res.json(service);
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/services/my - List services created by logged-in user
// ════════════════════════════════════════════════════════════════════════════════
router.get('/my', requireAuth, (req, res) => {
  const services = readServices();
  const myServices = services.filter(s => s.providerRollNumber === req.user.rollNumber);
  
  myServices.sort((a, b) => b.createdAt - a.createdAt);
  res.json(myServices);
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/services/:id/toggle - Toggle availability
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id/toggle', requireAuth, (req, res) => {
  const services = readServices();
  const index = services.findIndex(s => s.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: 'Service not found.' });

  // Security: Only owner can toggle
  if (services[index].providerRollNumber !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized.' });
  }

  services[index].isAvailable = !services[index].isAvailable;
  writeServices(services);

  res.json(services[index]);
});

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/services/:id - Delete service
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, (req, res) => {
  let services = readServices();
  const service = services.find(s => s.id === req.params.id);

  if (!service) return res.status(404).json({ error: 'Service not found.' });

  // Security: Only owner can delete
  if (service.providerRollNumber !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized.' });
  }

  services = services.filter(s => s.id !== req.params.id);
  writeServices(services);

  res.json({ message: 'Service deleted.' });
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/services/:id - Update service
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id', requireAuth, (req, res) => {
  const { title, description, price, category, contact } = req.body;

  const services = readServices();
  const index = services.findIndex(s => s.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: 'Service not found.' });

  // Ownership check
  if (services[index].providerRollNumber !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized.' });
  }

  // Update fields
  if (title) services[index].title = title;
  if (description) services[index].description = description;
  if (price !== undefined) {
    const numericPrice = parseFloat(price);
    if (!isNaN(numericPrice) && numericPrice > 0) {
      services[index].price = numericPrice;
    }
  }
  if (category) services[index].category = category;
  if (contact) services[index].contact = contact;

  writeServices(services);
  res.json(services[index]);
});

module.exports = router;

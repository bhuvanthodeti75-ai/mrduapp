const express = require('express');
const { requireAuth } = require('./auth');
const router = express.Router();
const { users, services } = require('../db/database');
const { createNotification } = require('./notifications');

const VALID_CATEGORIES = ['Assignment', 'Lab Record', 'PPT', 'Notes', 'Project'];

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/services - Add new service
// ════════════════════════════════════════════════════════════════════════════════
router.post('/', requireAuth, async (req, res) => {
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

  try {
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

    await services.insert(newService);

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
  } catch (err) {
    console.error('Error creating service:', err.message);
    res.status(500).json({ error: 'Failed to create service.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/services - List all available services
// ════════════════════════════════════════════════════════════════════════════════
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search, category } = req.query;
    let list = await services.find({ isAvailable: true }).sort({ createdAt: -1 });

    // Privacy: Remove contact info from general listing
    list = list.map(s => {
      const { contact, ...rest } = s;
      return rest;
    });

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(s => 
        (s.title && s.title.toLowerCase().includes(q)) || 
        (s.description && s.description.toLowerCase().includes(q))
      );
    }

    if (category && category !== 'All') {
      list = list.filter(s => s.category === category);
    }

    res.json(list);
  } catch (err) {
    console.error('Error listing services:', err.message);
    res.status(500).json({ error: 'Failed to retrieve services.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/services/:id - Get single service
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const service = await services.findOne({ id: req.params.id });
    if (!service) return res.status(404).json({ error: 'Service not found.' });
    res.json(service);
  } catch (err) {
    console.error('Error fetching service details:', err.message);
    res.status(500).json({ error: 'Failed to retrieve service details.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/services/my - List services created by logged-in user
// ════════════════════════════════════════════════════════════════════════════════
router.get('/my', requireAuth, async (req, res) => {
  try {
    const myServices = await services.find({ providerRollNumber: req.user.rollNumber }).sort({ createdAt: -1 });
    res.json(myServices);
  } catch (err) {
    console.error('Error listing my services:', err.message);
    res.status(500).json({ error: 'Failed to retrieve your services.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/services/:id/toggle - Toggle availability
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id/toggle', requireAuth, async (req, res) => {
  try {
    const service = await services.findOne({ id: req.params.id });

    if (!service) return res.status(404).json({ error: 'Service not found.' });

    // Security: Only owner can toggle
    if (service.providerRollNumber !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const nextAvailable = !service.isAvailable;
    await services.update({ id: req.params.id }, { isAvailable: nextAvailable });

    const updated = { ...service, isAvailable: nextAvailable };
    res.json(updated);
  } catch (err) {
    console.error('Error toggling service availability:', err.message);
    res.status(500).json({ error: 'Failed to update service availability.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/services/:id - Delete service
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const service = await services.findOne({ id: req.params.id });

    if (!service) return res.status(404).json({ error: 'Service not found.' });

    // Security: Only owner can delete
    if (service.providerRollNumber !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    await services.remove({ id: req.params.id });
    res.json({ message: 'Service deleted.' });
  } catch (err) {
    console.error('Error deleting service:', err.message);
    res.status(500).json({ error: 'Failed to delete service.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/services/:id - Update service
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id', requireAuth, async (req, res) => {
  const { title, description, price, category, contact } = req.body;

  try {
    const service = await services.findOne({ id: req.params.id });

    if (!service) return res.status(404).json({ error: 'Service not found.' });

    // Ownership check
    if (service.providerRollNumber !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const updates = {};
    if (title) updates.title = title;
    if (description) updates.description = description;
    if (price !== undefined) {
      const numericPrice = parseFloat(price);
      if (!isNaN(numericPrice) && numericPrice > 0) {
        updates.price = numericPrice;
      }
    }
    if (category) updates.category = category;
    if (contact) updates.contact = contact;

    await services.update({ id: req.params.id }, updates);

    const updatedService = { ...service, ...updates };
    res.json(updatedService);
  } catch (err) {
    console.error('Error updating service:', err.message);
    res.status(500).json({ error: 'Failed to update service.' });
  }
});

module.exports = router;

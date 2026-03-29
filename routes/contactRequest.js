const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('./auth');
const { createNotification } = require('./notifications');
const router = express.Router();

const CONTACT_REQUESTS_FILE = path.join(__dirname, '..', 'contactRequests.json');
const MARKETPLACE_FILE = path.join(__dirname, '..', 'marketplace.json');

// Helpers to read/write contact requests
function readRequests() {
  try {
    if (!fs.existsSync(CONTACT_REQUESTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(CONTACT_REQUESTS_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

function writeRequests(requests) {
  fs.writeFileSync(CONTACT_REQUESTS_FILE, JSON.stringify(requests, null, 2));
}

// Helper to read marketplace data
function readMarketplace() {
  try {
    if (!fs.existsSync(MARKETPLACE_FILE)) return [];
    return JSON.parse(fs.readFileSync(MARKETPLACE_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

const SERVICES_FILE = path.join(__dirname, '..', 'services.json');
const COURSES_FILE = path.join(__dirname, '..', 'courses.json');

// Helper to read services data
function readServices() {
  try {
    if (!fs.existsSync(SERVICES_FILE)) return [];
    return JSON.parse(fs.readFileSync(SERVICES_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

// Helper to read courses data
function readCourses() {
  try {
    if (!fs.existsSync(COURSES_FILE)) return [];
    return JSON.parse(fs.readFileSync(COURSES_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

const ITEM_REQUESTS_FILE = path.join(__dirname, '..', 'requests.json');

// Helper to read item requests
function readItemRequests() {
  try {
    if (!fs.existsSync(ITEM_REQUESTS_FILE)) return [];
    return JSON.parse(fs.readFileSync(ITEM_REQUESTS_FILE, 'utf-8'));
  } catch (err) {
    return [];
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/contact-request - Create a request
// ════════════════════════════════════════════════════════════════════════════════
router.post('/', requireAuth, (req, res) => {
  const { targetId, targetType } = req.body; // targetType: 'marketplace' or 'service'
  const buyerRollNumber = req.user.rollNumber;

  if (!targetId || !targetType) {
    return res.status(400).json({ error: 'Target ID and Type are required.' });
  }

  let item = null;
  if (targetType === 'marketplace') {
    const marketplace = readMarketplace();
    item = marketplace.find(i => i.id === targetId);
  } else if (targetType === 'service') {
    const services = readServices();
    item = services.find(s => s.id === targetId);
  } else if (targetType === 'course') {
    const courses = readCourses();
    item = courses.find(c => c.id === targetId);
  } else if (targetType === 'request') {
    const itemRequests = readItemRequests();
    item = itemRequests.find(r => r.id === targetId);
  }

  if (!item) return res.status(404).json({ error: 'Item/Service not found.' });
  
  const sellerRollNumber = item.sellerRollNumber || item.providerRollNumber || item.instructorRollNumber || item.requestedBy;
  if (sellerRollNumber === buyerRollNumber) {
    return res.status(400).json({ error: 'You cannot request contact for your own listing.' });
  }

  const requests = readRequests();

  // Prevent duplicate requests
  const existing = requests.find(r => r.targetId === targetId && r.buyerRollNumber === buyerRollNumber && r.targetType === targetType);
  if (existing) return res.status(400).json({ error: 'Request already sent.' });

  const newRequest = {
    id: Date.now().toString(),
    targetId,
    targetType,
    itemName: item.title,
    buyerRollNumber,
    sellerRollNumber,
    status: 'pending',
    createdAt: Date.now()
  };

  requests.push(newRequest);
  writeRequests(requests);

  createNotification(
    sellerRollNumber,
    'contact_request',
    `${buyerRollNumber} requested contact for ${item.title}.`,
    '/dashboard.html'
  ).catch(err => console.error("Error notifying seller:", err));

  createNotification(
    buyerRollNumber,
    'contact_request',
    `You requested contact details for ${item.title}.`,
    '/dashboard.html'
  ).catch(err => console.error("Error notifying buyer:", err));

  res.status(201).json(newRequest);
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/contact-request/my - List requests for the seller
// ════════════════════════════════════════════════════════════════════════════════
router.get('/my', requireAuth, (req, res) => {
  const requests = readRequests();
  const myRequests = requests.filter(r => r.sellerRollNumber === req.user.rollNumber);
  
  // Sort by latest first
  myRequests.sort((a, b) => b.createdAt - a.createdAt);
  
  res.json(myRequests);
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/contact-request/:id - Update status (Accept/Reject)
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id', requireAuth, (req, res) => {
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be accepted or rejected.' });
  }

  const requests = readRequests();
  const index = requests.findIndex(r => r.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: 'Request not found.' });

  // Security: Only seller can update
  if (requests[index].sellerRollNumber !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized.' });
  }

  requests[index].status = status;
  writeRequests(requests);

  // Auto-enroll if it's a course and accepted
  if (status === 'accepted' && requests[index].targetType === 'course') {
    const ENROLLMENTS_FILE = path.join(__dirname, '..', 'enrollments.json');
    let enrollments = [];
    try {
      if (fs.existsSync(ENROLLMENTS_FILE)) {
        enrollments = JSON.parse(fs.readFileSync(ENROLLMENTS_FILE, 'utf-8'));
      }
    } catch (e) {}

    const alreadyEnrolled = enrollments.some(e => 
      e.courseId === requests[index].targetId && e.studentRollNumber === requests[index].buyerRollNumber
    );

    if (!alreadyEnrolled) {
      enrollments.push({
        courseId: requests[index].targetId,
        studentRollNumber: requests[index].buyerRollNumber,
        enrolledAt: Date.now()
      });
      fs.writeFileSync(ENROLLMENTS_FILE, JSON.stringify(enrollments, null, 2));
    }
  }

  if (status === 'accepted') {
    createNotification(
      requests[index].buyerRollNumber,
      'contact_accepted',
      `${requests[index].sellerRollNumber} accepted your contact request for ${requests[index].itemName}!`,
      '#'
    ).catch(err => console.error("Error notifying buyer of acceptance:", err));
  } else if (status === 'rejected') {
    createNotification(
      requests[index].buyerRollNumber,
      'contact_rejected',
      `${requests[index].sellerRollNumber} declined your contact request for ${requests[index].itemName}.`,
      '#'
    ).catch(err => console.error("Error notifying buyer of rejection:", err));
  }

  res.json(requests[index]);
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/contact-request/status/:targetId - Check status for buyer
// ════════════════════════════════════════════════════════════════════════════════
router.get('/status/:targetId', requireAuth, (req, res) => {
  const { targetType } = req.query; // Expect targetType as query param or we can infer it
  const requests = readRequests();
  const request = requests.find(r => r.targetId === req.params.targetId && r.buyerRollNumber === req.user.rollNumber && (!targetType || r.targetType === targetType));

  if (!request) return res.json({ status: 'none' });

  if (request.status === 'accepted') {
    let contact = 'Not available';
    if (request.targetType === 'marketplace') {
      const marketplace = readMarketplace();
      const item = marketplace.find(i => i.id === req.params.targetId);
      if (item) contact = item.contact;
    } else if (request.targetType === 'service') {
      const services = readServices();
      const service = services.find(s => s.id === req.params.targetId);
      if (service) contact = service.contact;
    } else if (request.targetType === 'course') {
      const courses = readCourses();
      const course = courses.find(c => c.id === req.params.targetId);
      if (course) contact = course.contact;
    } else if (request.targetType === 'request') {
      const itemRequests = readItemRequests();
      const reqItem = itemRequests.find(r => r.id === req.params.targetId);
      if (reqItem) contact = reqItem.contact;
    }
    
    return res.json({
      status: 'accepted',
      contact: contact
    });
  }

  res.json({ status: request.status });
});

module.exports = router;

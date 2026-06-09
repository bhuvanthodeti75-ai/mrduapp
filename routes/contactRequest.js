const express = require('express');
const { requireAuth } = require('./auth');
const { 
  createNotification 
} = require('./notifications');
const { 
  contactRequests, 
  marketplace, 
  services, 
  courses, 
  requests, 
  enrollments 
} = require('../db/database');

const router = express.Router();

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/contact-request - Create a request
// ════════════════════════════════════════════════════════════════════════════════
router.post('/', requireAuth, async (req, res) => {
  const { targetId, targetType } = req.body; // targetType: 'marketplace' or 'service'
  const buyerRollNumber = req.user.rollNumber;

  if (!targetId || !targetType) {
    return res.status(400).json({ error: 'Target ID and Type are required.' });
  }

  try {
    let item = null;
    if (targetType === 'marketplace') {
      item = await marketplace.findOne({ id: targetId });
    } else if (targetType === 'service') {
      item = await services.findOne({ id: targetId });
    } else if (targetType === 'course') {
      item = await courses.findOne({ id: targetId });
    } else if (targetType === 'request') {
      item = await requests.findOne({ id: targetId });
    }

    if (!item) return res.status(404).json({ error: 'Item/Service not found.' });
    
    const sellerRollNumber = item.sellerRollNumber || item.providerRollNumber || item.instructorRollNumber || item.requestedBy;
    if (sellerRollNumber === buyerRollNumber) {
      return res.status(400).json({ error: 'You cannot request contact for your own listing.' });
    }

    // Prevent duplicate requests
    const existing = await contactRequests.findOne({ 
      targetId, 
      buyerRollNumber, 
      targetType 
    });
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

    await contactRequests.insert(newRequest);

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
  } catch (err) {
    console.error('Error creating contact request:', err.message);
    res.status(500).json({ error: 'Failed to submit contact request.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/contact-request/my - List requests for the seller
// ════════════════════════════════════════════════════════════════════════════════
router.get('/my', requireAuth, async (req, res) => {
  try {
    const list = await contactRequests.find({ sellerRollNumber: req.user.rollNumber }).sort({ createdAt: -1 });
    res.json(list);
  } catch (err) {
    console.error('Error listing contact requests:', err.message);
    res.status(500).json({ error: 'Failed to retrieve contact requests.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/contact-request/:id - Update status (Accept/Reject)
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id', requireAuth, async (req, res) => {
  const { status } = req.body;
  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status. Must be accepted or rejected.' });
  }

  try {
    const request = await contactRequests.findOne({ id: req.params.id });

    if (!request) return res.status(404).json({ error: 'Request not found.' });

    // Security: Only seller can update
    if (request.sellerRollNumber !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    await contactRequests.update({ id: req.params.id }, { status });

    // Auto-enroll if it's a course and accepted
    if (status === 'accepted' && request.targetType === 'course') {
      const alreadyEnrolled = await enrollments.findOne({ 
        courseId: request.targetId, 
        studentRollNumber: request.buyerRollNumber 
      });

      if (!alreadyEnrolled) {
        await enrollments.insert({
          courseId: request.targetId,
          studentRollNumber: request.buyerRollNumber,
          enrolledAt: Date.now()
        });
      }
    }

    if (status === 'accepted') {
      createNotification(
        request.buyerRollNumber,
        'contact_accepted',
        `${request.sellerRollNumber} accepted your contact request for ${request.itemName}!`,
        '#'
      ).catch(err => console.error("Error notifying buyer of acceptance:", err));
    } else if (status === 'rejected') {
      createNotification(
        request.buyerRollNumber,
        'contact_rejected',
        `${request.sellerRollNumber} declined your contact request for ${request.itemName}.`,
        '#'
      ).catch(err => console.error("Error notifying buyer of rejection:", err));
    }

    const updated = { ...request, status };
    res.json(updated);
  } catch (err) {
    console.error('Error updating contact request:', err.message);
    res.status(500).json({ error: 'Failed to update contact request.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/contact-request/status/:targetId - Check status for buyer
// ════════════════════════════════════════════════════════════════════════════════
router.get('/status/:targetId', requireAuth, async (req, res) => {
  const { targetType } = req.query; // Expect targetType as query param or we can infer it
  
  try {
    const query = { 
      targetId: req.params.targetId, 
      buyerRollNumber: req.user.rollNumber 
    };
    if (targetType) query.targetType = targetType;

    const request = await contactRequests.findOne(query);

    if (!request) return res.json({ status: 'none' });

    if (request.status === 'accepted') {
      let contact = 'Not available';
      if (request.targetType === 'marketplace') {
        const item = await marketplace.findOne({ id: req.params.targetId });
        if (item) contact = item.contact;
      } else if (request.targetType === 'service') {
        const service = await services.findOne({ id: req.params.targetId });
        if (service) contact = service.contact;
      } else if (request.targetType === 'course') {
        const course = await courses.findOne({ id: req.params.targetId });
        if (course) contact = course.contact;
      } else if (request.targetType === 'request') {
        const reqItem = await requests.findOne({ id: req.params.targetId });
        if (reqItem) contact = reqItem.contact;
      }
      
      return res.json({
        status: 'accepted',
        contact: contact
      });
    }

    res.json({ status: request.status });
  } catch (err) {
    console.error('Error checking request status:', err.message);
    res.status(500).json({ error: 'Failed to retrieve request status.' });
  }
});

module.exports = router;

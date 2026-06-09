const express = require('express');
const path = require('path');
const multer = require('multer');
const { requireAuth } = require('./auth');
const router = express.Router();
const { users, courses, enrollments, uploadToSupabaseStorage } = require('../db/database');
const { createNotification } = require('./notifications');

// Configure Multer memory storage
const storage = multer.memoryStorage();
const upload = multer({ storage });

// Helper to enrich courses with instructor names
async function enrichCourses(coursesList) {
  return Promise.all(coursesList.map(async c => {
    try {
      const user = await users.findOne({ rollNumber: c.instructorRollNumber });
      return {
        ...c,
        instructorName: user && user.name ? user.name : c.instructorRollNumber
      };
    } catch (err) {
      return { ...c, instructorName: c.instructorRollNumber };
    }
  }));
}

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/courses - List all courses
// ════════════════════════════════════════════════════════════════════════════════
router.get('/', requireAuth, async (req, res) => {
  try {
    const { search } = req.query;
    let list = await courses.find({}).sort({ createdAt: -1 });

    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c => 
        (c.title && c.title.toLowerCase().includes(q)) || 
        (c.description && c.description.toLowerCase().includes(q))
      );
    }

    const enriched = await enrichCourses(list);
    res.json(enriched);
  } catch (err) {
    console.error('Error listing courses:', err.message);
    res.status(500).json({ error: 'Failed to retrieve courses.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/courses/my - List courses created by the user
// ════════════════════════════════════════════════════════════════════════════════
router.get('/my', requireAuth, async (req, res) => {
  try {
    const list = await courses.find({ instructorRollNumber: req.user.rollNumber }).sort({ createdAt: -1 });
    const enriched = await enrichCourses(list);
    res.json(enriched);
  } catch (err) {
    console.error('Error listing my courses:', err.message);
    res.status(500).json({ error: 'Failed to retrieve your courses.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/courses/enrolled - List enrolled courses
// ════════════════════════════════════════════════════════════════════════════════
router.get('/enrolled', requireAuth, async (req, res) => {
  try {
    const myEnrollments = await enrollments.find({ studentRollNumber: req.user.rollNumber });
    const myEnrollmentIds = myEnrollments.map(e => e.courseId);

    const allCourses = await courses.find({}).sort({ createdAt: -1 });
    const myEnrolledCourses = allCourses.filter(c => myEnrollmentIds.includes(c.id));

    const enriched = await enrichCourses(myEnrolledCourses);
    res.json(enriched);
  } catch (err) {
    console.error('Error listing enrolled courses:', err.message);
    res.status(500).json({ error: 'Failed to retrieve enrolled courses.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/courses/:id - Get course details
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:id', requireAuth, async (req, res) => {
  try {
    const course = await courses.findOne({ id: req.params.id });
    if (!course) return res.status(404).json({ error: 'Course not found.' });

    const enrollMatch = await enrollments.findOne({ 
      courseId: course.id, 
      studentRollNumber: req.user.rollNumber 
    });
    const isEnrolled = !!enrollMatch;
    const isInstructor = course.instructorRollNumber === req.user.rollNumber;

    let instructorName = course.instructorRollNumber;
    try {
      const user = await users.findOne({ rollNumber: course.instructorRollNumber });
      if (user && user.name) instructorName = user.name;
    } catch (err) {}

    // Content protection: Only show content and contact if enrolled or instructor
    const responseData = { ...course, isEnrolled, isInstructor, instructorName };
    if (!isEnrolled && !isInstructor) {
      delete responseData.content;
      delete responseData.contact;
    }

    res.json(responseData);
  } catch (err) {
    console.error('Error fetching course details:', err.message);
    res.status(500).json({ error: 'Failed to retrieve course details.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/courses - Add new course
// ════════════════════════════════════════════════════════════════════════════════
router.post('/', requireAuth, upload.array('files'), async (req, res) => {
  const { title, description, contact, price, content } = req.body;

  let contentLinks = [];
  if (content) {
    contentLinks = Array.isArray(content) ? content : [content];
  }

  // Validation
  if (!title || !description || !contact) {
    return res.status(400).json({ error: 'Title, description, and contact are required.' });
  }

  try {
    const uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const filename = `course-${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        const fileUrl = await uploadToSupabaseStorage(file.buffer, filename, file.mimetype);
        uploadedFiles.push(fileUrl);
      }
    }

    if (contentLinks.length === 0 && uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'Please provide at least one link or upload a file.' });
    }

    const newCourse = {
      id: Date.now().toString(),
      title,
      description,
      contact,
      price: parseFloat(price) || 0,
      content: [...contentLinks, ...uploadedFiles],
      instructorRollNumber: req.user.rollNumber,
      createdAt: Date.now()
    };

    await courses.insert(newCourse);

    createNotification(
      req.user.rollNumber,
      'feed_post',
      `You created the course "${title}".`,
      `/my-courses.html`
    ).catch(err => console.error("Error creating course notification:", err));

    // Broadcast to all other users
    users.find({}).then(allUsers => {
      const broadcastPromises = allUsers
        .filter(u => u.rollNumber !== req.user.rollNumber)
        .map(u => createNotification(
          u.rollNumber,
          'feed_post',
          `${req.user.rollNumber} launched a new course: ${title}`,
          '/courses.html'
        ));
      
      Promise.all(broadcastPromises).catch(err => console.error("Error in parallel course broadcast:", err));
    }).catch(err => console.error("Error broadcasting course notification:", err));

    res.status(201).json(newCourse);
  } catch (err) {
    console.error('Error creating course:', err.message);
    res.status(500).json({ error: 'Failed to create course.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/courses/enroll - Enroll user
// ════════════════════════════════════════════════════════════════════════════════
router.post('/enroll', requireAuth, async (req, res) => {
  const { courseId } = req.body;
  if (!courseId) return res.status(400).json({ error: 'Course ID is required.' });

  try {
    const course = await courses.findOne({ id: courseId });
    if (!course) return res.status(404).json({ error: 'Course not found.' });

    // Prevent duplicate enrollment
    const alreadyEnrolled = await enrollments.findOne({ 
      courseId, 
      studentRollNumber: req.user.rollNumber 
    });

    if (alreadyEnrolled) {
      return res.status(400).json({ error: 'You are already enrolled in this course.' });
    }

    const newEnrollment = {
      courseId,
      studentRollNumber: req.user.rollNumber,
      enrolledAt: Date.now()
    };

    await enrollments.insert(newEnrollment);
    res.status(201).json({ message: 'Enrolled successfully.', enrollment: newEnrollment });
  } catch (err) {
    console.error('Error enrolling in course:', err.message);
    res.status(500).json({ error: 'Failed to enroll in course.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/courses/:id - Update course
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id', requireAuth, upload.array('files'), async (req, res) => {
  const { title, description, contact, price, content } = req.body;

  try {
    const course = await courses.findOne({ id: req.params.id });
    if (!course) return res.status(404).json({ error: 'Course not found.' });

    // Ownership check
    if (course.instructorRollNumber !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    const uploadedFiles = [];
    if (req.files && req.files.length > 0) {
      for (const file of req.files) {
        const filename = `course-${Date.now()}-${Math.round(Math.random() * 1E9)}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
        const fileUrl = await uploadToSupabaseStorage(file.buffer, filename, file.mimetype);
        uploadedFiles.push(fileUrl);
      }
    }

    const updates = {};
    if (title) updates.title = title;
    if (description) updates.description = description;
    if (contact) updates.contact = contact;
    if (price !== undefined) updates.price = parseFloat(price) || 0;
    
    let newContent = course.content || [];
    if (content) {
      const contentLinks = Array.isArray(content) ? content : [content];
      newContent = [...contentLinks];
    }
    if (uploadedFiles.length > 0) {
      newContent = [...newContent, ...uploadedFiles];
    }
    updates.content = newContent;

    await courses.update({ id: req.params.id }, updates);

    const updatedCourse = { ...course, ...updates };
    res.json(updatedCourse);
  } catch (err) {
    console.error('Error updating course:', err.message);
    res.status(500).json({ error: 'Failed to update course.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/courses/:id - Delete course
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const course = await courses.findOne({ id: req.params.id });
    if (!course) return res.status(404).json({ error: 'Course not found.' });

    // Ownership check
    if (course.instructorRollNumber !== req.user.rollNumber) {
      return res.status(403).json({ error: 'Unauthorized.' });
    }

    await courses.remove({ id: req.params.id });
    
    // Cleanup enrollments
    await enrollments.remove({ courseId: req.params.id });

    res.json({ message: 'Course deleted successfully.' });
  } catch (err) {
    console.error('Error deleting course:', err.message);
    res.status(500).json({ error: 'Failed to delete course.' });
  }
});

module.exports = router;

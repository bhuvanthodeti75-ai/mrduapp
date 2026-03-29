const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { requireAuth } = require('./auth');
const router = express.Router();
const { users } = require('../db/database');
const { createNotification } = require('./notifications');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '..', 'uploads');
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Preserve extensions nicely while avoiding special chars in the base
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_'));
  }
});
const upload = multer({ storage });

const COURSES_FILE = path.join(__dirname, '..', 'courses.json');
const ENROLLMENTS_FILE = path.join(__dirname, '..', 'enrollments.json');

// Helper to read JSON data
function readData(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    const data = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    console.error(`Error reading ${filePath}:`, err);
    return [];
  }
}

// Helper to write JSON data
function writeData(filePath, items) {
  try {
    fs.writeFileSync(filePath, JSON.stringify(items, null, 2));
  } catch (err) {
    console.error(`Error writing ${filePath}:`, err);
  }
}

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/courses - List all courses
// ════════════════════════════════════════════════════════════════════════════════
router.get('/', requireAuth, (req, res) => {
  let courses = readData(COURSES_FILE);
  const { search } = req.query;

  if (search) {
    const q = search.toLowerCase();
    courses = courses.filter(c => 
      c.title.toLowerCase().includes(q) || 
      c.description.toLowerCase().includes(q)
    );
  }

  // Sort by latest first
  courses.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  res.json(courses);
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/courses/my - List courses created by the user
// ════════════════════════════════════════════════════════════════════════════════
router.get('/my', requireAuth, (req, res) => {
  const courses = readData(COURSES_FILE);
  const myCourses = courses.filter(c => c.instructorRollNumber === req.user.rollNumber);
  myCourses.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  res.json(myCourses);
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/courses/enrolled - List enrolled courses
// ════════════════════════════════════════════════════════════════════════════════
router.get('/enrolled', requireAuth, (req, res) => {
  const enrollments = readData(ENROLLMENTS_FILE);
  const courses = readData(COURSES_FILE);
  
  const myEnrollmentIds = enrollments
    .filter(e => e.studentRollNumber === req.user.rollNumber)
    .map(e => e.courseId);
  
  const myEnrolledCourses = courses.filter(c => myEnrollmentIds.includes(c.id));
  myEnrolledCourses.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  
  res.json(myEnrolledCourses);
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/courses/:id - Get course details
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:id', requireAuth, (req, res) => {
  const courses = readData(COURSES_FILE);
  const enrollments = readData(ENROLLMENTS_FILE);
  
  const course = courses.find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found.' });

  const isEnrolled = enrollments.some(e => 
    e.courseId === course.id && e.studentRollNumber === req.user.rollNumber
  );

  const isInstructor = course.instructorRollNumber === req.user.rollNumber;

  // Content protection: Only show content and contact if enrolled or instructor
  const responseData = { ...course, isEnrolled, isInstructor };
  if (!isEnrolled && !isInstructor) {
    delete responseData.content;
    delete responseData.contact;
  }

  res.json(responseData);
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/courses - Add new course
// ════════════════════════════════════════════════════════════════════════════════
router.post('/', requireAuth, upload.array('files'), (req, res) => {
  const { title, description, contact, price, content } = req.body;

  let contentLinks = [];
  if (content) {
    contentLinks = Array.isArray(content) ? content : [content];
  }
  const uploadedFiles = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];

  // Validation
  if (!title || !description || !contact) {
    return res.status(400).json({ error: 'Title, description, and contact are required.' });
  }
  if (contentLinks.length === 0 && uploadedFiles.length === 0) {
    return res.status(400).json({ error: 'Please provide at least one link or upload a file.' });
  }

  const courses = readData(COURSES_FILE);
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

  courses.push(newCourse);
  writeData(COURSES_FILE, courses);

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
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/courses/enroll - Enroll user
// ════════════════════════════════════════════════════════════════════════════════
router.post('/enroll', requireAuth, (req, res) => {
  const { courseId } = req.body;
  if (!courseId) return res.status(400).json({ error: 'Course ID is required.' });

  const courses = readData(COURSES_FILE);
  const enrollments = readData(ENROLLMENTS_FILE);

  const course = courses.find(c => c.id === courseId);
  if (!course) return res.status(404).json({ error: 'Course not found.' });

  // Prevent duplicate enrollment
  const alreadyEnrolled = enrollments.some(e => 
    e.courseId === courseId && e.studentRollNumber === req.user.rollNumber
  );

  if (alreadyEnrolled) {
    return res.status(400).json({ error: 'You are already enrolled in this course.' });
  }

  const newEnrollment = {
    courseId,
    studentRollNumber: req.user.rollNumber,
    enrolledAt: Date.now()
  };

  enrollments.push(newEnrollment);
  writeData(ENROLLMENTS_FILE, enrollments);

  res.status(201).json({ message: 'Enrolled successfully.', enrollment: newEnrollment });
});

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /api/courses/:id - Update course
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:id', requireAuth, upload.array('files'), (req, res) => {
  const { title, description, contact, price, content } = req.body;
  const uploadedFiles = req.files ? req.files.map(f => `/uploads/${f.filename}`) : [];

  const courses = readData(COURSES_FILE);
  const index = courses.findIndex(c => c.id === req.params.id);

  if (index === -1) return res.status(404).json({ error: 'Course not found.' });

  // Ownership check
  if (courses[index].instructorRollNumber !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized.' });
  }

  // Update fields
  if (title) courses[index].title = title;
  if (description) courses[index].description = description;
  if (contact) courses[index].contact = contact;
  if (price !== undefined) courses[index].price = parseFloat(price) || 0;
  
  // Merge content links if provided
  let newContent = courses[index].content || [];
  if (content) {
    const contentLinks = Array.isArray(content) ? content : [content];
    newContent = [...contentLinks]; // Replace or merge logic - here we replace
  }
  if (uploadedFiles.length > 0) {
    newContent = [...newContent, ...uploadedFiles];
  }
  courses[index].content = newContent;

  writeData(COURSES_FILE, courses);
  res.json(courses[index]);
});

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /api/courses/:id - Delete course
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/:id', requireAuth, (req, res) => {
  let courses = readData(COURSES_FILE);
  const course = courses.find(c => c.id === req.params.id);

  if (!course) return res.status(404).json({ error: 'Course not found.' });

  // Ownership check
  if (course.instructorRollNumber !== req.user.rollNumber) {
    return res.status(403).json({ error: 'Unauthorized.' });
  }

  courses = courses.filter(c => c.id !== req.params.id);
  writeData(COURSES_FILE, courses);

  // Optional: Cleanup enrollments
  let enrollments = readData(ENROLLMENTS_FILE);
  enrollments = enrollments.filter(e => e.courseId !== req.params.id);
  writeData(ENROLLMENTS_FILE, enrollments);

  res.json({ message: 'Course deleted successfully.' });
});

module.exports = router;

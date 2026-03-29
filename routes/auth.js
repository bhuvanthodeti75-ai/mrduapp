require('dotenv').config();
const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const { users, otpStore } = require('../db/database');

const router = express.Router();

// ─── Email transporter ─────────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ─── Helpers ───────────────────────────────────────────────────────────────────
function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  const visible = local.slice(0, 2);
  const masked = '*'.repeat(Math.max(local.length - 2, 4));
  return `${visible}${masked}@${domain}`;
}

function createToken(rollNumber) {
  return jwt.sign({ rollNumber }, process.env.JWT_SECRET, { expiresIn: '24h' });
}

function verifyToken(token) {
  try { return jwt.verify(token, process.env.JWT_SECRET); }
  catch { return null; }
}

function getCourseFromDepartment(dept) {
  if (!dept) return 'CSE';
  dept = dept.toUpperCase();
  if (dept.includes('DS') || dept.includes('DATA SCIENCE')) return 'DS';
  if (dept.includes('AIML') || dept.includes('AI') || dept.includes('ML')) return 'AIML';
  return 'CSE';
}

async function getUserCourseAndSection(userRollNumber) {
  let user = await users.findOne({ rollNumber: userRollNumber });
  let needsUpdate = false;
  let updateData = {};

  if (!user.course) {
    user.course = getCourseFromDepartment(user.department);
    updateData.course = user.course;
    needsUpdate = true;
  }

  if (!user.section) {
    const allUsers = await users.find({}).sort({ rollNumber: 1 });
    const courseUsers = allUsers.filter(u => {
      const c = u.course || getCourseFromDepartment(u.department);
      return c === user.course;
    });

    const index = courseUsers.findIndex(u => u.rollNumber === userRollNumber);
    if (index !== -1) {
      const sectionIndex = Math.min(Math.floor(index / 90), 7);
      user.section = String.fromCharCode(65 + sectionIndex);
    } else {
      user.section = 'A';
    }
    updateData.section = user.section;
    needsUpdate = true;
  }

  if (needsUpdate) {
    await users.update({ rollNumber: userRollNumber }, { $set: updateData });
  }

  return { course: user.course, section: user.section };
}

// ─── Middleware: require full auth JWT ─────────────────────────────────────────
function requireAuth(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  const payload = verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Session expired. Please login again.' });
  req.user = payload;
  next();
}

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/auth/login
// ════════════════════════════════════════════════════════════════════════════════
router.post('/login', async (req, res) => {
  try {
    const { rollNumber, password } = req.body;
    if (!rollNumber || !password) {
      return res.status(400).json({ error: 'Roll number and password are required.' });
    }

    const user = await users.findOne({ rollNumber: rollNumber.trim().toUpperCase() });

    // 1. Roll number not found
    if (!user) return res.status(401).json({ error: 'Unauthorized user' });


    // 3. Check password
    const passwordMatch = bcrypt.compareSync(password, user.password);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Incorrect password' });
    }

    // 4. Normal login for everyone (Unverified users are validated at dashboard limits)
    const token = createToken(user.rollNumber);
    res.cookie('token', token, { httpOnly: true, maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' });
    return res.json({
      message: 'Login successful',
      user: { rollNumber: user.rollNumber, name: user.name, email: user.email, department: user.department, isVerified: user.isVerified },
    });
  } catch (err) {
    console.error('/login error:', err);
    return res.status(500).json({ error: 'Internal error.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/auth/send-otp
// ════════════════════════════════════════════════════════════════════════════════
router.post('/send-otp', requireAuth, async (req, res) => {
  try {
    const { rollNumber } = req.user;
    const user = await users.findOne({ rollNumber });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const otp = generateOTP();
    const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 5;
    const expiresAt = Date.now() + expiryMinutes * 60 * 1000;

    // Upsert OTP record
    const existing = await otpStore.findOne({ rollNumber });
    if (existing) {
      await otpStore.update({ rollNumber }, { $set: { otp, expiresAt, attempts: 0 } });
    } else {
      await otpStore.insert({ rollNumber, otp, expiresAt, attempts: 0 });
    }

    // Send email
    await transporter.sendMail({
      from: `"MRDU Portal" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Your MRDU Portal OTP Code',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #0f0f1a; color: #e2e8f0; padding: 32px; border-radius: 16px;">
          <div style="text-align:center; margin-bottom: 24px;">
            <h1 style="color: #a78bfa; font-size: 24px; margin: 0;">Malla Reddy Deemed to be University</h1>
            <p style="color: #94a3b8; font-size: 14px; margin-top: 4px;">Student Portal Security Code</p>
          </div>
          <p style="font-size: 16px; margin-bottom: 8px;">Hello <strong>${user.name}</strong>,</p>
          <p style="color: #94a3b8; font-size: 14px;">Your one-time verification code is:</p>
          <div style="background: #1e1b4b; border: 2px solid #a78bfa; border-radius: 12px; text-align: center; padding: 24px; margin: 20px 0;">
            <span style="font-size: 42px; font-weight: 900; letter-spacing: 12px; color: #a78bfa;">${otp}</span>
          </div>
          <p style="color: #94a3b8; font-size: 13px;">⏱ This code expires in <strong>${expiryMinutes} minutes</strong>.</p>
          <p style="color: #94a3b8; font-size: 13px;">🔒 Do NOT share this code with anyone.</p>
          <hr style="border-color: #334155; margin: 24px 0;">
          <p style="color: #475569; font-size: 12px; text-align:center;">Malla Reddy Deemed to be University · IT Department<br>This is an automated message. Do not reply.</p>
        </div>
      `,
    });

    return res.json({ message: 'OTP sent to registered email.', maskedEmail: maskEmail(user.email) });
  } catch (err) {
    console.error('/send-otp error:', err.message);
    if (err.message?.includes('Invalid login') || err.message?.includes('auth')) {
      return res.status(500).json({
        error: 'Email configuration error. Check EMAIL_USER and EMAIL_PASS in .env file.',
        dev_hint: err.message,
      });
    }
    return res.status(500).json({ error: 'Failed to send OTP. Please try again.', dev_hint: err.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/auth/verify-otp
// ════════════════════════════════════════════════════════════════════════════════
router.post('/verify-otp', requireAuth, async (req, res) => {
  try {
    const { otp } = req.body;
    const { rollNumber } = req.user;
    if (!otp) return res.status(400).json({ error: 'OTP is required.' });

    const record = await otpStore.findOne({ rollNumber });
    if (!record) return res.status(400).json({ error: 'No OTP found. Please request a new one.' });

    if (Date.now() > record.expiresAt) {
      await otpStore.remove({ rollNumber }, {});
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }

    if (otp.trim() !== record.otp) {
      return res.status(401).json({ error: 'Invalid OTP' });
    }

    // OTP verified — delete it and issue short cookie to unlock password change step
    await otpStore.remove({ rollNumber }, {});
    res.cookie('otpVerified', 'true', { httpOnly: true, maxAge: 15 * 60 * 1000, sameSite: 'lax' });
    return res.json({ message: 'OTP verified. You may now set a new password.' });
  } catch (err) {
    console.error('/verify-otp error:', err);
    return res.status(500).json({ error: 'Internal error.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/auth/change-password
// ════════════════════════════════════════════════════════════════════════════════
router.post('/change-password', requireAuth, async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    const { rollNumber } = req.user;

    const hasValidatedOtp = req.cookies?.otpVerified;
    if (!hasValidatedOtp) return res.status(403).json({ error: 'OTP verification required first.' });
    if (!newPassword || !confirmPassword) return res.status(400).json({ error: 'Both password fields are required.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });

    const user = await users.findOne({ rollNumber });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await users.update({ rollNumber }, { $set: { password: hashedPassword, isFirstLogin: false, isVerified: true } });

    res.clearCookie('otpVerified');
    
    return res.json({
      message: 'Password set successfully. Welcome to MRDU Portal!',
      user: { rollNumber: user.rollNumber, name: user.name, email: user.email, department: user.department },
    });
  } catch (err) {
    console.error('/change-password error:', err);
    return res.status(500).json({ error: 'Internal error.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /api/auth/me
// ════════════════════════════════════════════════════════════════════════════════
router.get('/me', requireAuth, async (req, res) => {
  try {
    const user = await users.findOne({ rollNumber: req.user.rollNumber });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const { course, section } = await getUserCourseAndSection(user.rollNumber);

    return res.json({
      user: { 
        rollNumber: user.rollNumber, 
        name: user.name, 
        email: user.email, 
        department: user.department, 
        course: course,
        section: section,
        isVerified: user.isVerified 
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal error.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/auth/logout
// ════════════════════════════════════════════════════════════════════════════════
router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.clearCookie('tempToken');
  res.clearCookie('resetToken');
  return res.json({ message: 'Logged out successfully.' });
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/auth/forgot-password
// ════════════════════════════════════════════════════════════════════════════════
router.post('/forgot-password', async (req, res) => {
  try {
    const { rollNumber } = req.body;
    if (!rollNumber) return res.status(400).json({ error: 'Roll number is required.' });

    const user = await users.findOne({ rollNumber: rollNumber.trim().toUpperCase() });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const otp = generateOTP();
    const expiryMinutes = parseInt(process.env.OTP_EXPIRY_MINUTES) || 5;
    const expiresAt = Date.now() + expiryMinutes * 60 * 1000;

    const existing = await otpStore.findOne({ rollNumber: user.rollNumber });
    if (existing) {
      await otpStore.update({ rollNumber: user.rollNumber }, { $set: { otp, expiresAt, attempts: 0 } });
    } else {
      await otpStore.insert({ rollNumber: user.rollNumber, otp, expiresAt, attempts: 0 });
    }

    await transporter.sendMail({
      from: `"MRDU Portal" <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Password Reset Request',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto; background: #0f0f1a; color: #e2e8f0; padding: 32px; border-radius: 16px;">
          <div style="text-align:center; margin-bottom: 24px;">
            <h1 style="color: #a78bfa; font-size: 24px; margin: 0;">Malla Reddy Deemed to be University</h1>
            <p style="color: #94a3b8; font-size: 14px; margin-top: 4px;">Password Reset Security Code</p>
          </div>
          <p style="font-size: 16px; margin-bottom: 8px;">Hello <strong>${user.name}</strong>,</p>
          <p style="color: #94a3b8; font-size: 14px;">Your password reset verification code is:</p>
          <div style="background: #1e1b4b; border: 2px solid #a78bfa; border-radius: 12px; text-align: center; padding: 24px; margin: 20px 0;">
            <span style="font-size: 42px; font-weight: 900; letter-spacing: 12px; color: #a78bfa;">${otp}</span>
          </div>
          <p style="color: #94a3b8; font-size: 13px;">⏱ This code expires in <strong>${expiryMinutes} minutes</strong>.</p>
          <hr style="border-color: #334155; margin: 24px 0;">
          <p style="color: #475569; font-size: 12px; text-align:center;">This is an automated message. Do not reply.</p>
        </div>
      `,
    });

    return res.json({ message: 'Password reset OTP sent to registered email.', maskedEmail: maskEmail(user.email) });
  } catch (err) {
    console.error('/forgot-password error:', err);
    return res.status(500).json({ error: 'Failed to send OTP.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/auth/forgot-password-verify
// ════════════════════════════════════════════════════════════════════════════════
router.post('/forgot-password-verify', async (req, res) => {
  try {
    const { rollNumber, otp } = req.body;
    if (!rollNumber || !otp) return res.status(400).json({ error: 'Roll number and OTP are required.' });

    const normalizedRoll = rollNumber.trim().toUpperCase();
    const record = await otpStore.findOne({ rollNumber: normalizedRoll });
    
    if (!record) return res.status(400).json({ error: 'No OTP found. Please request a new one.' });

    if (Date.now() > record.expiresAt) {
      await otpStore.remove({ rollNumber: normalizedRoll }, {});
      return res.status(400).json({ error: 'OTP expired. Please request a new one.' });
    }

    if (otp.trim() !== record.otp) {
      return res.status(401).json({ error: 'Invalid OTP' });
    }

    // Success! Issue a short-lived reset token specifically for this roll number
    await otpStore.remove({ rollNumber: normalizedRoll }, {});
    const resetToken = jwt.sign({ rollNumber: normalizedRoll, flow: 'reset' }, process.env.JWT_SECRET, { expiresIn: '15m' });
    res.cookie('resetToken', resetToken, { httpOnly: true, maxAge: 15 * 60 * 1000, sameSite: 'lax' });
    
    return res.json({ message: 'OTP verified. You may now reset your password.' });
  } catch (err) {
    console.error('/forgot-password-verify error:', err);
    return res.status(500).json({ error: 'Internal error.' });
  }
});

// ════════════════════════════════════════════════════════════════════════════════
// POST /api/auth/reset-password
// ════════════════════════════════════════════════════════════════════════════════
router.post('/reset-password', async (req, res) => {
  try {
    const { newPassword, confirmPassword } = req.body;
    
    // We expect the JWT to be in cookies.resetToken
    const token = req.cookies?.resetToken;
    if (!token) return res.status(403).json({ error: 'Reset session expired or invalid. Please verify OTP again.' });
    
    const payload = verifyToken(token);
    if (!payload || payload.flow !== 'reset') return res.status(403).json({ error: 'Invalid reset session.' });

    if (!newPassword || !confirmPassword) return res.status(400).json({ error: 'Both password fields are required.' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    if (newPassword !== confirmPassword) return res.status(400).json({ error: 'Passwords do not match.' });

    const user = await users.findOne({ rollNumber: payload.rollNumber });
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    // Setting isVerified to true since they technically validated their email via forgot password
    await users.update({ rollNumber: payload.rollNumber }, { $set: { password: hashedPassword, isFirstLogin: false, isVerified: true } });

    res.clearCookie('resetToken');
    return res.json({ message: 'Password reset successfully. You can now login.' });
  } catch (err) {
    console.error('/reset-password error:', err);
    return res.status(500).json({ error: 'Internal error.' });
  }
});

module.exports = router;
module.exports.requireAuth = requireAuth;
module.exports.getUserCourseAndSection = getUserCourseAndSection;

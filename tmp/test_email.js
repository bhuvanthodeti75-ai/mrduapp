require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

async function testEmail() {
  try {
    console.log('Testing email transport...');
    console.log('User:', process.env.EMAIL_USER);
    // console.log('Pass:', process.env.EMAIL_PASS); // Masked for safety

    await transporter.verify();
    console.log('Transporter is ready to take messages');

    const info = await transporter.sendMail({
      from: `"MRDU Test" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER, // Send to self
      subject: 'Test Email from MRDU Portal',
      text: 'If you receive this, the OTP system is working correctly.',
    });

    console.log('Message sent: %s', info.messageId);
  } catch (error) {
    console.error('Error occurred:', error.message);
  }
}

testEmail();

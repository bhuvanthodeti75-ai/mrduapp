const Datastore = require('nedb-promises');
const path = require('path');

const DB_DIR = path.join(__dirname);

// Users collection
const users = Datastore.create({
  filename: path.join(DB_DIR, 'users.db'),
  autoload: true,
});

// OTP store collection
const otpStore = Datastore.create({
  filename: path.join(DB_DIR, 'otp_store.db'),
  autoload: true,
});

// Messages collection
const messages = Datastore.create({
  filename: path.join(DB_DIR, 'messages.db'),
  autoload: true,
});

// Chat Requests collection
const chatRequests = Datastore.create({
  filename: path.join(DB_DIR, 'chat_requests.db'),
  autoload: true,
});

// Notifications collection
const notifications = Datastore.create({
  filename: path.join(DB_DIR, 'notifications.db'),
  autoload: true,
});

// Ensure unique indexes
users.ensureIndex({ fieldName: 'rollNumber', unique: true }).catch(() => {});
users.ensureIndex({ fieldName: 'email', unique: true }).catch(() => {});
otpStore.ensureIndex({ fieldName: 'rollNumber', unique: true }).catch(() => {});

console.log('Database (NeDB) initialized at:', DB_DIR);

module.exports = { users, otpStore, messages, chatRequests, notifications };

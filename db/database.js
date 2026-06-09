const Datastore = require('nedb-promises');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Load environment variables if they haven't been loaded
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const DB_DIR = path.join(__dirname);

// Initialize Supabase Client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('WARNING: Supabase URL or Key is missing in environment variables.');
}

const supabase = createClient(supabaseUrl, supabaseKey);

function applyFilters(supabaseQuery, query) {
  let builder = supabaseQuery;
  
  const queryCopy = { ...query };
  // If we have a query with _id, map to id
  if (queryCopy._id) {
    queryCopy.id = queryCopy._id;
    delete queryCopy._id;
  }
  
  for (const [key, value] of Object.entries(queryCopy)) {
    if (key === '$or') {
      const orParts = value.map(cond => {
        const condParts = Object.entries(cond).map(([k, v]) => {
          const actualKey = k === '_id' ? 'id' : k;
          return `${actualKey}.eq.${v}`;
        });
        if (condParts.length > 1) {
          return `and(${condParts.join(',')})`;
        } else {
          return condParts[0];
        }
      });
      builder = builder.or(orParts.join(','));
    } else if (value && typeof value === 'object') {
      builder = builder.eq(key, value);
    } else {
      builder = builder.eq(key, value);
    }
  }
  return builder;
}

class SupabaseCursor {
  constructor(executeFn) {
    this.executeFn = executeFn;
    this._sort = null;
    this._limit = null;
  }

  sort(sortObj) {
    this._sort = sortObj;
    return this;
  }

  limit(limitVal) {
    this._limit = limitVal;
    return this;
  }

  async exec() {
    return this.executeFn(this._sort, this._limit);
  }

  then(onFulfilled, onRejected) {
    return this.exec().then(onFulfilled, onRejected);
  }

  catch(onRejected) {
    return this.exec().catch(onRejected);
  }
}

class SupabaseCollection {
  constructor(client, tableName) {
    this.client = client;
    this.tableName = tableName;
  }

  mapFromDb(row) {
    if (!row) return row;
    const doc = { ...row };
    if (doc.id) {
      doc._id = doc.id;
    }
    return doc;
  }

  mapToDb(doc) {
    if (!doc) return doc;
    const row = { ...doc };
    if (row._id) {
      row.id = row._id;
      delete row._id;
    }
    return row;
  }

  find(query = {}) {
    return new SupabaseCursor(async (sortObj, limitVal) => {
      let q = this.client.from(this.tableName).select('*');
      q = applyFilters(q, query);
      
      if (sortObj) {
        for (const [key, direction] of Object.entries(sortObj)) {
          const actualKey = key === '_id' ? 'id' : key;
          q = q.order(actualKey, { ascending: direction === 1 });
        }
      }
      
      if (limitVal !== null && limitVal !== undefined) {
        q = q.limit(limitVal);
      }

      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return (data || []).map(r => this.mapFromDb(r));
    });
  }

  async findOne(query = {}) {
    let q = this.client.from(this.tableName).select('*');
    q = applyFilters(q, query);
    q = q.limit(1);
    
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    return data && data.length > 0 ? this.mapFromDb(data[0]) : null;
  }

  async insert(doc) {
    const row = this.mapToDb(doc);
    const { data, error } = await this.client
      .from(this.tableName)
      .insert(row)
      .select();

    if (error) {
      if (error.code === '23505') {
        const err = new Error(error.message);
        err.errorType = 'uniqueViolated';
        throw err;
      }
      throw new Error(error.message);
    }
    return data && data.length > 0 ? this.mapFromDb(data[0]) : null;
  }

  async update(query, updateObj, options = {}) {
    let updateFields = updateObj;
    if (updateObj.$set) {
      updateFields = updateObj.$set;
    }
    
    const rowFields = this.mapToDb(updateFields);
    
    let q = this.client.from(this.tableName).update(rowFields);
    q = applyFilters(q, query);
    
    const { data, error } = await q.select();
    if (error) throw new Error(error.message);
    
    return data ? data.length : 0;
  }

  async remove(query, options = {}) {
    let q = this.client.from(this.tableName).delete();
    q = applyFilters(q, query);
    
    const { data, error } = await q.select();
    if (error) throw new Error(error.message);
    return data ? data.length : 0;
  }

  async ensureIndex() {
    return true;
  }
}

// ─── Firebase Firestore Collection Wrapper ──────────────────────────────────────
class FirestoreCollection {
  constructor(db, collectionName) {
    this.db = db;
    this.collectionName = collectionName;
  }

  buildQuery(query) {
    let q = this.db.collection(this.collectionName);
    for (const [key, value] of Object.entries(query)) {
      q = q.where(key, '==', value);
    }
    return q;
  }

  async findOne(query = {}) {
    const q = this.buildQuery(query).limit(1);
    const snapshot = await q.get();
    if (snapshot.empty) return null;
    const doc = snapshot.docs[0];
    return { _id: doc.id, ...doc.data() };
  }

  async insert(doc) {
    const id = doc.id || doc._id || this.db.collection(this.collectionName).doc().id;
    const data = { ...doc };
    delete data._id;
    data.id = id;

    await this.db.collection(this.collectionName).doc(id).set(data);
    return { _id: id, ...data };
  }

  find(query = {}) {
    return {
      sort: (sortObj) => {
        return {
          then: async (onFulfilled, onRejected) => {
            try {
              let q = this.buildQuery(query);
              const snapshot = await q.get();
              const results = [];
              snapshot.forEach(doc => {
                results.push({ _id: doc.id, ...doc.data() });
              });
              if (sortObj) {
                results.sort((a, b) => {
                  for (const [key, direction] of Object.entries(sortObj)) {
                    const aVal = a[key];
                    const bVal = b[key];
                    if (aVal < bVal) return direction === -1 ? 1 : -1;
                    if (aVal > bVal) return direction === -1 ? -1 : 1;
                  }
                  return 0;
                });
              }
              return onFulfilled(results);
            } catch (err) {
              if (onRejected) return onRejected(err);
              throw err;
            }
          }
        };
      }
    };
  }

  async count(query = {}) {
    const q = this.buildQuery(query);
    const snapshot = await q.get();
    return snapshot.size;
  }

  async update(query, updateObj) {
    let updateFields = updateObj;
    if (updateObj.$set) {
      updateFields = updateObj.$set;
    }
    const data = { ...updateFields };
    delete data._id;

    const q = this.buildQuery(query);
    const snapshot = await q.get();
    if (snapshot.empty) return 0;

    const batch = this.db.batch();
    snapshot.docs.forEach(doc => {
      batch.update(doc.ref, data);
    });
    await batch.commit();
    return snapshot.size;
  }

  async remove(query) {
    const q = this.buildQuery(query);
    const snapshot = await q.get();
    if (snapshot.empty) return 0;

    const batch = this.db.batch();
    snapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    await batch.commit();
    return snapshot.size;
  }

  async ensureIndex() {
    return true;
  }
}

// ─── Hybrid Notifications Collection (Resilient Fallback) ──────────────────────
class HybridNotificationsCollection {
  constructor(firestoreColl, nedbColl) {
    this.firestore = firestoreColl;
    this.nedb = nedbColl;
    this.useFirestore = !!firestoreColl;
  }

  async findOne(query) {
    if (this.useFirestore) {
      try {
        return await this.firestore.findOne(query);
      } catch (err) {
        console.warn('Firestore findOne failed, falling back to local NeDB:', err.message);
        this.useFirestore = false;
      }
    }
    return await this.nedb.findOne(query);
  }

  find(query) {
    return {
      sort: (sortObj) => {
        return {
          then: async (onFulfilled, onRejected) => {
            try {
              if (this.useFirestore) {
                try {
                  const results = await new Promise((resolve, reject) => {
                    this.firestore.find(query).sort(sortObj).then(resolve, reject);
                  });
                  return onFulfilled(results);
                } catch (err) {
                  console.warn('Firestore find failed, falling back to local NeDB:', err.message);
                  this.useFirestore = false;
                }
              }
              const results = await this.nedb.find(query).sort(sortObj);
              return onFulfilled(results);
            } catch (err) {
              if (onRejected) return onRejected(err);
              throw err;
            }
          }
        };
      }
    };
  }

  async insert(doc) {
    if (this.useFirestore) {
      try {
        return await this.firestore.insert(doc);
      } catch (err) {
        console.warn('Firestore insert failed, falling back to local NeDB:', err.message);
        this.useFirestore = false;
      }
    }
    return await this.nedb.insert(doc);
  }

  async count(query) {
    if (this.useFirestore) {
      try {
        return await this.firestore.count(query);
      } catch (err) {
        console.warn('Firestore count failed, falling back to local NeDB:', err.message);
        this.useFirestore = false;
      }
    }
    return await this.nedb.count(query);
  }

  async update(query, updateObj, options) {
    if (this.useFirestore) {
      try {
        return await this.firestore.update(query, updateObj, options);
      } catch (err) {
        console.warn('Firestore update failed, falling back to local NeDB:', err.message);
        this.useFirestore = false;
      }
    }
    return await this.nedb.update(query, updateObj, options);
  }

  async remove(query, options) {
    if (this.useFirestore) {
      try {
        return await this.firestore.remove(query, options);
      } catch (err) {
        console.warn('Firestore remove failed, falling back to local NeDB:', err.message);
        this.useFirestore = false;
      }
    }
    return await this.nedb.remove(query, options);
  }

  async ensureIndex() {
    return true;
  }
}

// Supabase-backed collections
const users = new SupabaseCollection(supabase, 'users');
const otpStore = new SupabaseCollection(supabase, 'otp_store');
const messages = new SupabaseCollection(supabase, 'messages');
const chatRequests = new SupabaseCollection(supabase, 'chat_requests');

// New migrated Supabase-backed collections
const marketplace = new SupabaseCollection(supabase, 'marketplace');
const courses = new SupabaseCollection(supabase, 'courses');
const enrollments = new SupabaseCollection(supabase, 'enrollments');
const promotions = new SupabaseCollection(supabase, 'promotions');
const services = new SupabaseCollection(supabase, 'services');
const requests = new SupabaseCollection(supabase, 'requests');
const contactRequests = new SupabaseCollection(supabase, 'contact_requests');

// Supabase Storage file upload helper
async function uploadToSupabaseStorage(buffer, filename, mimetype) {
  try {
    const { data, error } = await supabase.storage
      .from('mrdu-media')
      .upload(filename, buffer, {
        contentType: mimetype,
        upsert: true
      });

    if (error) throw error;

    const { data: publicUrlData } = supabase.storage
      .from('mrdu-media')
      .getPublicUrl(filename);

    return publicUrlData.publicUrl;
  } catch (err) {
    console.error('Failed to upload file to Supabase Storage:', err.message);
    throw err;
  }
}

// Initialize Firebase Admin SDK
let firebaseDb = null;
try {
  const { initializeApp, cert, getApps, getApp } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  const serviceAccountPath = path.join(__dirname, '..', 'firebase-service-account.json');
  
  let app;
  if (getApps().length === 0) {
    if (fs.existsSync(serviceAccountPath)) {
      const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf-8'));
      app = initializeApp({
        credential: cert(serviceAccount)
      });
      console.log('Firebase initialized using local service account JSON.');
    } else if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      app = initializeApp({
        credential: cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
        })
      });
      console.log('Firebase initialized using environment variables.');
    } else {
      console.warn('WARNING: Firebase credentials missing. Falling back to local NeDB mode.');
    }
  } else {
    app = getApp();
    console.log('Firebase already initialized, reusing existing app.');
  }
  
  if (getApps().length > 0) {
    firebaseDb = getFirestore();
  }
} catch (err) {
  console.error('Failed to initialize Firebase Admin SDK:', err.message);
}

// Setup local NeDB for fallback
const localNedbNotifications = Datastore.create({
  filename: path.join(DB_DIR, 'notifications.db'),
  autoload: true,
});

// Setup Notifications Collection with Hybrid Fallback
let notifications;
if (firebaseDb) {
  const firestoreNotifications = new FirestoreCollection(firebaseDb, 'notifications');
  notifications = new HybridNotificationsCollection(firestoreNotifications, localNedbNotifications);
  console.log('Database initialized: Supabase for users/OTP/chat, Firebase Firestore (with NeDB fallback) for notifications.');
} else {
  notifications = new HybridNotificationsCollection(null, localNedbNotifications);
  console.log('Database initialized: Supabase for users/OTP/chat, NeDB (local) for notifications.');
}

module.exports = { 
  users, 
  otpStore, 
  messages, 
  chatRequests, 
  notifications,
  marketplace,
  courses,
  enrollments,
  promotions,
  services,
  requests,
  contactRequests,
  uploadToSupabaseStorage
};

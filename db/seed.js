require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');
const { users } = require('./database');

const DB_JSON_PATH = path.join(__dirname, '..', 'Studentdatabase.json');

async function seed() {
  console.log('Reading Studentdatabase.json...');

  const raw = fs.readFileSync(DB_JSON_PATH, 'utf-8');
  const data = JSON.parse(raw);
  const students = data['All Students Combined'];

  if (!students || !Array.isArray(students)) {
    console.error('ERROR: Could not find "All Students Combined" array.');
    process.exit(1);
  }

  console.log(`Found ${students.length} students. Seeding database...`);

  let inserted = 0;
  let skipped = 0;

  for (const student of students) {
    const rollNumber = student['Roll No']?.trim();
    const email = student['Email ID']?.trim();
    const name = student['Student Name']?.trim();
    const department = student['Department/Section']?.trim();

    if (!rollNumber || !email) { skipped++; continue; }

    // Default password = roll number (hashed with bcrypt)
    const hashedPassword = bcrypt.hashSync(rollNumber, 10);

    try {
      await users.insert({
        rollNumber,
        email,
        name,
        department,
        password: hashedPassword,
        isFirstLogin: true,
        isVerified: false,
        loginAttempts: 0,
        lockedUntil: null,
        createdAt: new Date(),
      });
      inserted++;

      if (inserted % 100 === 0) {
        process.stdout.write(`\r   Inserted ${inserted}/${students.length}...`);
      }
    } catch (err) {
      // Duplicate = already seeded
      if (err.errorType === 'uniqueViolated') {
        skipped++;
      } else {
        console.error(`\nError inserting ${rollNumber}:`, err.message);
        skipped++;
      }
    }
  }

  console.log(`\n\n✅ Seeding complete!`);
  console.log(`   ↳ Inserted : ${inserted} students`);
  console.log(`   ↳ Skipped  : ${skipped} (duplicates or invalid)`);
  console.log(`\nDefault password for each student = their Roll Number`);
  console.log(`Example: Roll No 25EU06R0001 → Password: 25EU06R0001`);
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed failed:', err);
  process.exit(1);
});

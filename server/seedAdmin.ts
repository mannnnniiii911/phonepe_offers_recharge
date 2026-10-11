import bcrypt from 'bcryptjs';
import { db } from './db';

const username = process.argv[2] || 'admin';
const email = process.argv[3] || 'admin@phonepe-recharge.local';
const password = process.argv[4] || 'AdminPassword@2026!';

console.log(`Setting up initial administrator: ${username} (${email})...`);

const existing = db.prepare('SELECT id FROM admin_users WHERE username = ? OR email = ?').get(username, email) as { id: string } | undefined;
const salt = bcrypt.genSaltSync(12);
const passwordHash = bcrypt.hashSync(password, salt);
const now = new Date().toISOString();

if (existing) {
  db.prepare(`
    UPDATE admin_users
    SET password_hash = ?, role = 'owner', status = 'active', updated_at = ?
    WHERE id = ?
  `).run(passwordHash, now, existing.id);
  console.log(`✅ Administrator '${username}' password and owner privileges updated successfully.`);
} else {
  const id = 'admin-owner-' + Date.now();
  db.prepare(`
    INSERT INTO admin_users (id, username, email, password_hash, role, status, created_at, updated_at)
    VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?)
  `).run(id, username, email, passwordHash, now, now);
  console.log(`✅ Created owner administrator '${username}' successfully.`);
}

console.log(`Credentials: Username: ${username} | Email: ${email}`);
process.exit(0);

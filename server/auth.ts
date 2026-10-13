import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { postgresQuery } from './postgres';

const JWT_SECRET = process.env.JWT_SECRET || 'antigravity-phonepe-admin-supersecret-jwt-key-2026';
const TOKEN_EXPIRY = '8h';

export interface AdminPayload {
  id: string;
  username: string;
  email: string;
  role: 'owner' | 'manager' | 'viewer';
}
export interface AuthenticatedRequest extends Request { admin?: AdminPayload; }

export function generateToken(payload: AdminPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}
export function setAuthCookie(res: Response, token: string) {
  res.cookie('admin_token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000, path: '/' });
}
export function clearAuthCookie(res: Response) {
  res.clearCookie('admin_token', { httpOnly: true, sameSite: 'lax', path: '/' });
}

// PostgreSQL middleware must finish the database check before allowing the request through.
export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  let token = req.cookies?.admin_token;
  if (!token && req.headers.authorization?.startsWith('Bearer ')) token = req.headers.authorization.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Authentication required. Please log in.' });
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AdminPayload;
    const result = await postgresQuery<{id:string; username:string; email:string; role:AdminPayload['role']; status:string}>(
      'SELECT id, username, email, role, status FROM admin_users WHERE id = $1 LIMIT 1', [decoded.id]
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active') return res.status(401).json({ error: 'User account inactive or session invalid.' });
    req.admin = { id:user.id, username:user.username, email:user.email, role:user.role };
    return next();
  } catch (err) {
    console.error('[AUTH_ERROR] PostgreSQL authentication check failed:', err);
    return res.status(401).json({ error: 'Session expired or invalid. Please log in again.' });
  }
}

export function requireRole(allowedRoles: ('owner' | 'manager' | 'viewer')[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.admin) return res.status(401).json({ error: 'Authentication required.' });
    if (!allowedRoles.includes(req.admin.role)) return res.status(403).json({ error: `Permission denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${req.admin.role}.` });
    return next();
  };
}

export async function logAudit(admin: { id: string; username: string } | undefined, action: string, entityType: string, entityId: string, summary: string, req?: Request) {
  const adminId = admin?.id || 'system';
  const adminUsername = admin?.username || 'system';
  const forwarded = req?.headers['x-forwarded-for'];
  const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]) || req?.socket?.remoteAddress || '127.0.0.1';
  try {
    await postgresQuery(
      'INSERT INTO admin_audit_logs (id, admin_id, admin_username, action, entity_type, entity_id, summary, ip_address, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING',
      ['audit-' + crypto.randomUUID(), adminId, adminUsername, action, entityType, entityId, summary, ip, new Date().toISOString()]
    );
  } catch (err) { console.error('[AUDIT_ERROR] Failed to write PostgreSQL audit log:', err); }
}

type LoginAttempt = { attempts: number; last_attempt: number; blocked_until: number };
export async function checkLoginRateLimit(ip: string): Promise<{allowed:boolean; retryAfterSeconds?:number}> {
  const now = Date.now();
  const result = await postgresQuery<LoginAttempt>('SELECT attempts, last_attempt, blocked_until FROM login_attempts WHERE ip = $1', [ip]);
  const record = result.rows[0];
  if (record) {
    if (Number(record.blocked_until) > now) return { allowed:false, retryAfterSeconds:Math.ceil((Number(record.blocked_until)-now)/1000) };
    if (now - Number(record.last_attempt) > 15 * 60 * 1000) {
      await postgresQuery('UPDATE login_attempts SET attempts = 0, last_attempt = $1, blocked_until = 0 WHERE ip = $2', [now, ip]);
    }
  }
  return { allowed:true };
}
export async function recordFailedLogin(ip: string): Promise<void> {
  const now = Date.now();
  await postgresQuery(
    `INSERT INTO login_attempts (ip, attempts, last_attempt, blocked_until) VALUES ($1,1,$2,0)
     ON CONFLICT (ip) DO UPDATE SET attempts = CASE WHEN $2 - login_attempts.last_attempt > 900000 THEN 1 ELSE login_attempts.attempts + 1 END,
     last_attempt = $2,
     blocked_until = CASE WHEN (CASE WHEN $2 - login_attempts.last_attempt > 900000 THEN 1 ELSE login_attempts.attempts + 1 END) >= 5 THEN $2 + 900000 ELSE 0 END`,
    [ip, now]
  );
}
export async function resetLoginRateLimit(ip: string): Promise<void> {
  await postgresQuery('DELETE FROM login_attempts WHERE ip = $1', [ip]);
}

import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { postgresQuery } from '../postgres';
import { generateToken, setAuthCookie, clearAuthCookie, requireAuth, logAudit, checkLoginRateLimit, recordFailedLogin, resetLoginRateLimit, type AuthenticatedRequest } from '../auth';

export const authRouter = Router();

authRouter.post('/login', async (req, res) => {
  try {
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]) || req.socket.remoteAddress || '127.0.0.1';
    const { identifier, password } = req.body ?? {};
    if (!identifier || !password) return res.status(400).json({ error: 'Username/Email and password are required.' });

    const rateLimit = await checkLoginRateLimit(ip);
    if (!rateLimit.allowed) return res.status(429).json({ error: `Too many failed login attempts. Please wait ${rateLimit.retryAfterSeconds} seconds before trying again.` });

    const cleanIdentifier = String(identifier).trim();
    const result = await postgresQuery<{id:string;username:string;email:string;password_hash:string;role:'owner'|'manager'|'viewer';status:string}>(
      'SELECT id, username, email, password_hash, role, status FROM admin_users WHERE username = $1 OR email = $1 LIMIT 1',
      [cleanIdentifier]
    );
    const user = result.rows[0];
    if (!user || user.status !== 'active' || !(await bcrypt.compare(String(password), user.password_hash))) {
      await recordFailedLogin(ip);
      return res.status(401).json({ error: 'Invalid credentials or inactive account.' });
    }

    await resetLoginRateLimit(ip);
    const payload = { id:user.id, username:user.username, email:user.email, role:user.role };
    const token = generateToken(payload);
    setAuthCookie(res, token);
    await logAudit(payload, 'ADMIN_LOGIN', 'ADMIN_USER', user.id, `Administrator ${user.username} logged in successfully`, req);
    return res.json({ success:true, user:payload, token });
  } catch (err) {
    console.error('[AUTH_ERROR] POST /login:', err);
    return res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

authRouter.post('/logout', requireAuth, async (req: AuthenticatedRequest, res) => {
  if (req.admin) await logAudit(req.admin, 'ADMIN_LOGOUT', 'ADMIN_USER', req.admin.id, `Administrator ${req.admin.username} logged out`, req);
  clearAuthCookie(res);
  return res.json({ success:true, message:'Logged out successfully.' });
});

authRouter.get('/me', requireAuth, (req: AuthenticatedRequest, res) => res.json({ success:true, user:req.admin }));

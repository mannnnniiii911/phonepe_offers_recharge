import { Router } from 'express';
import { db } from '../db';
import { requireAuth, requireRole, logAudit, type AuthenticatedRequest } from '../auth';

export const adminSettingsRouter = Router();

adminSettingsRouter.use(requireAuth);

// GET /api/admin/settings - Get all settings
adminSettingsRouter.get('/', (_req, res) => {
  try {
    const rows = db.prepare('SELECT setting_key, setting_value, updated_at, updated_by FROM website_settings').all() as Array<{
      setting_key: string;
      setting_value: string;
      updated_at: string;
      updated_by: string;
    }>;

    const settings: Record<string, string> = {};
    for (const r of rows) {
      settings[r.setting_key] = r.setting_value;
    }

    res.json({ success: true, settings });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] GET /settings:', err);
    res.status(500).json({ error: 'Failed to retrieve settings' });
  }
});

// PUT /api/admin/settings - Update settings (Owner & Manager)
adminSettingsRouter.put('/', requireRole(['owner', 'manager']), (req: AuthenticatedRequest, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Invalid settings payload.' });
    }

    const now = new Date().toISOString();
    const adminUser = req.admin?.username || 'admin';

    const upsertStmt = db.prepare(`
      INSERT INTO website_settings (setting_key, setting_value, updated_at, updated_by)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(setting_key) DO UPDATE SET
        setting_value = excluded.setting_value,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `);

    db.transaction(() => {
      for (const [key, value] of Object.entries(updates)) {
        if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
          upsertStmt.run(key, String(value), now, adminUser);
        }
      }
    })();

    logAudit(req.admin, 'SETTINGS_UPDATE', 'WEBSITE_SETTINGS', 'ALL', `Updated website settings and promotional parameters`, req);

    res.json({ success: true, message: 'Settings updated successfully.' });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] PUT /settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

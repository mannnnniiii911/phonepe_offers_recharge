import { Router } from 'express';
import { dbAdapter } from '../dbAdapter';
import { requireAuth, requireRole, logAudit, type AuthenticatedRequest } from '../auth';

export const adminSettingsRouter = Router();

adminSettingsRouter.use(requireAuth);

// GET /api/admin/settings - Get all settings
adminSettingsRouter.get('/', async (_req, res) => {
  try {
    const result = await dbAdapter.query<{
      setting_key: string;
      setting_value: string;
      updated_at: string;
      updated_by: string;
    }>('SELECT setting_key, setting_value, updated_at, updated_by FROM website_settings');

    const settings: Record<string, string> = {};
    for (const r of result.rows) {
      settings[r.setting_key] = r.setting_value;
    }

    res.json({ success: true, settings });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] GET /settings:', err);
    res.status(500).json({ error: 'Failed to retrieve settings' });
  }
});

function isValidUpiId(id: string): boolean {
  return /^[a-zA-Z0-9.\-_]{2,100}@[a-zA-Z0-9.\-_]{2,50}$/.test(id.trim());
}

export function validateQrDataUri(value: string): { ok: true } | { ok: false; error: string } {
  const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp'];
  const MAX_DECODED_BYTES = 5 * 1024 * 1024; // 5 MB

  if (!value.startsWith('data:')) {
    return { ok: false, error: 'QR code must be provided as a Base64 data URI (data:image/...;base64,...).' };
  }

  const mimeMatch = value.match(/^data:([^;]+);base64,/);
  if (!mimeMatch) {
    return { ok: false, error: 'Invalid image data URI format. Expected: data:<mime>;base64,<data>.' };
  }

  const mime = mimeMatch[1].toLowerCase();
  const normalizedMime = mime === 'image/jpg' ? 'image/jpeg' : mime;
  if (!ALLOWED_IMAGE_MIMES.includes(normalizedMime)) {
    return { ok: false, error: 'Unsupported image format. Please upload JPEG, PNG, or WebP.' };
  }

  const base64Payload = value.slice(mimeMatch[0].length);

  if (!/^[A-Za-z0-9+/]+=*$/.test(base64Payload)) {
    return { ok: false, error: 'QR image contains malformed Base64 data.' };
  }

  const paddingCount = (base64Payload.match(/={1,2}$/) ?? [''])[0].length;
  const estimatedBytes = Math.floor((base64Payload.length * 3) / 4) - paddingCount;
  if (estimatedBytes > MAX_DECODED_BYTES) {
    return { ok: false, error: 'Image file size exceeds the maximum limit of 5 MB.' };
  }

  return { ok: true };
}

// PUT /api/admin/settings - Update settings (Owner & Manager)
adminSettingsRouter.put('/', requireRole(['owner', 'manager']), async (req: AuthenticatedRequest, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({ error: 'Invalid settings payload.' });
    }

    if ('upi_id' in updates) {
      const upi = String(updates.upi_id ?? '').trim();
      if (!upi) {
        return res.status(400).json({ error: 'UPI ID cannot be empty.' });
      }
      if (!isValidUpiId(upi)) {
        return res.status(400).json({ error: 'Invalid UPI ID format. Expected format: username@bank (e.g. user@ybl).' });
      }
      updates.upi_id = upi;
    }

    if ('qr_code_url' in updates) {
      const qrVal = String(updates.qr_code_url ?? '').trim();
      if (!qrVal) {
        return res.status(400).json({ error: 'QR Code image cannot be empty.' });
      }

      const validationResult = validateQrDataUri(qrVal);
      if (!validationResult.ok) {
        return res.status(400).json({ error: validationResult.error });
      }
    }

    const now = new Date().toISOString();
    const adminUser = req.admin?.username ?? 'admin';

    await dbAdapter.transaction(async (tx) => {
      for (const [key, value] of Object.entries(updates)) {
        if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') {
          await tx.execute(`
            INSERT INTO website_settings (setting_key, setting_value, updated_at, updated_by)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(setting_key) DO UPDATE SET
              setting_value = excluded.setting_value,
              updated_at = excluded.updated_at,
              updated_by = excluded.updated_by
          `, [key, String(value), now, adminUser]);
        }
      }
    });

    await logAudit(req.admin, 'SETTINGS_UPDATE', 'WEBSITE_SETTINGS', 'ALL', 'Updated website settings and promotional parameters', req);

    res.json({ success: true, message: 'Settings updated successfully.' });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] PUT /settings:', err);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

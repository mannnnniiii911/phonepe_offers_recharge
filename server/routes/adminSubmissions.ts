import { Router } from 'express';
import { postgresQuery } from '../postgres';
import { requireAuth, requireRole, logAudit, type AuthenticatedRequest } from '../auth';

export const adminSubmissionsRouter = Router();
adminSubmissionsRouter.use(requireAuth);

function maskPhoneNumber(phone: string): string {
  if (!phone || phone.length < 6) return '******';
  return `${phone.slice(0, 2)}******${phone.slice(-2)}`;
}
function parseSnapshot(value: unknown): unknown {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

// List submissions; phone numbers remain masked unless explicitly revealed by an authorized admin.
adminSubmissionsRouter.get('/', async (req, res) => {
  try {
    const { search, providerId, startDate, endDate, sort = 'desc', page = 1, limit = 20 } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit as string, 10) || 20));
    const offset = (pageNum - 1) * limitNum;
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (condition: (placeholder: string) => string, value: unknown) => {
      params.push(value);
      conditions.push(condition('$' + params.length));
    };
    if (search) {
      params.push(`%${String(search)}%`);
      const p1 = '$' + params.length;
      params.push(`%${String(search)}%`);
      const p2 = '$' + params.length;
      conditions.push(`(s.mobile_number ILIKE ${p1} OR s.id ILIKE ${p2})`);
    }
    if (providerId && providerId !== 'all') add(p => `s.provider_id = ${p}`, providerId as string);
    if (startDate) add(p => `s.created_at >= ${p}::date`, startDate as string);
    if (endDate) add(p => `s.created_at < (${p}::date + INTERVAL '1 day')`, endDate as string);
    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const count = await postgresQuery<{total:string|number}>(`SELECT COUNT(*) AS total FROM customer_submissions s ${whereClause}`, params);
    const listParams = [...params, limitNum, offset];
    const result = await postgresQuery<{
      id:string; rawMobile:string; providerId:string; providerName:string; providerLogo:string|null;
      planId:string|null; planSnapshot:unknown; status:string; consentVersion:string; createdAt:string;
    }>(`
      SELECT s.id, s.mobile_number AS "rawMobile", s.provider_id AS "providerId",
        s.provider_name AS "providerName", prov.logo_url AS "providerLogo",
        s.plan_id AS "planId", s.plan_snapshot AS "planSnapshot", s.status,
        s.consent_version AS "consentVersion", s.created_at AS "createdAt"
      FROM customer_submissions s
      LEFT JOIN network_providers prov ON s.provider_id = prov.id
      ${whereClause}
      ORDER BY s.created_at ${sort === 'asc' ? 'ASC' : 'DESC'}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `, listParams);
    const submissions = result.rows.map(r => ({
      id:r.id, maskedMobile:maskPhoneNumber(r.rawMobile), providerId:r.providerId,
      providerName:r.providerName, providerLogo:r.providerLogo, planId:r.planId,
      planSnapshot:parseSnapshot(r.planSnapshot), status:r.status,
      consentVersion:r.consentVersion, createdAt:r.createdAt,
    }));
    const total = Number(count.rows[0]?.total ?? 0);
    return res.json({ success:true, submissions, pagination:{ total, page:pageNum, limit:limitNum, totalPages:Math.ceil(total/limitNum) } });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] GET /submissions:', err);
    return res.status(500).json({ error:'Failed to retrieve submissions' });
  }
});

adminSubmissionsRouter.post('/:id/reveal', requireRole(['owner','manager']), async (req: AuthenticatedRequest, res) => {
  try {
    const result = await postgresQuery<{id:string; mobile_number:string}>('SELECT id, mobile_number FROM customer_submissions WHERE id = $1', [req.params.id]);
    const record = result.rows[0];
    if (!record) return res.status(404).json({ error:'Submission not found.' });
    await logAudit(req.admin, 'REVEAL_PHONE_NUMBER', 'CUSTOMER_SUBMISSION', record.id,
      `Administrator ${req.admin?.username} revealed confidential customer phone number for record ${record.id}`, req);
    return res.json({ success:true, id:record.id, mobileNumber:record.mobile_number });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] POST /submissions/:id/reveal:', err);
    return res.status(500).json({ error:'Failed to reveal number' });
  }
});

adminSubmissionsRouter.get('/export', requireRole(['owner','manager']), async (req: AuthenticatedRequest, res) => {
  try {
    const { providerId, startDate, endDate, includeFullNumbers } = req.query;
    const conditions: string[] = [];
    const params: unknown[] = [];
    const add = (condition: (placeholder:string)=>string, value:unknown) => { params.push(value); conditions.push(condition('$'+params.length)); };
    if (providerId && providerId !== 'all') add(p => `s.provider_id = ${p}`, providerId as string);
    if (startDate) add(p => `s.created_at >= ${p}::date`, startDate as string);
    if (endDate) add(p => `s.created_at < (${p}::date + INTERVAL '1 day')`, endDate as string);
    const whereClause = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const result = await postgresQuery<{id:string;mobile_number:string;provider_name:string;status:string;consent_version:string;created_at:string}>(`
      SELECT s.id, s.mobile_number, s.provider_name, s.status, s.consent_version, s.created_at
      FROM customer_submissions s ${whereClause} ORDER BY s.created_at DESC LIMIT 5000
    `, params);
    const sanitizeCsvCell = (val: unknown) => {
      let cell = String(val ?? '');
      if (/^[=+\-@\t\r]/.test(cell)) cell = "'" + cell;
      return `"${cell.replace(/"/g, '""')}"`;
    };
    const allowFull = includeFullNumbers === 'true' && req.admin?.role === 'owner';
    const lines = [['Submission ID','Mobile Number','Operator','Status','Consent Version','Date & Time'].join(',')];
    for (const r of result.rows) {
      lines.push([
        sanitizeCsvCell(r.id), sanitizeCsvCell(allowFull ? r.mobile_number : maskPhoneNumber(r.mobile_number)),
        sanitizeCsvCell(r.provider_name), sanitizeCsvCell(r.status), sanitizeCsvCell(r.consent_version),
        sanitizeCsvCell(r.created_at),
      ].join(','));
    }
    await logAudit(req.admin, 'EXPORT_CUSTOMER_DATA', 'CUSTOMER_SUBMISSIONS', 'BULK',
      `Exported ${result.rows.length} customer submission records (Full numbers: ${allowFull})`, req);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="customer_submissions_${Date.now()}.csv"`);
    return res.send(lines.join('\n'));
  } catch (err) {
    console.error('[ADMIN_API_ERROR] GET /submissions/export:', err);
    return res.status(500).json({ error:'Failed to export customer records' });
  }
});

adminSubmissionsRouter.delete('/:id', requireRole(['owner']), async (req: AuthenticatedRequest, res) => {
  try {
    const id = req.params.id;
    const existing = await postgresQuery<{id:string}>('SELECT id FROM customer_submissions WHERE id = $1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ error:'Record not found.' });
    await postgresQuery('DELETE FROM customer_submissions WHERE id = $1', [id]);
    await logAudit(req.admin, 'DELETE_CUSTOMER_RECORD', 'CUSTOMER_SUBMISSION', id, `Deleted customer submission ${id}`, req);
    return res.json({ success:true, message:'Record deleted.' });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] DELETE /submissions/:id:', err);
    return res.status(500).json({ error:'Failed to delete submission' });
  }
});

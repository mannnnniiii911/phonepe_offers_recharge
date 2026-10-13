import { Router } from 'express';
import { postgresQuery } from '../postgres';
import { requireAuth } from '../auth';

export const adminAuditRouter = Router();
adminAuditRouter.use(requireAuth);

adminAuditRouter.get('/', async (req, res) => {
  try {
    const { action, entityType, page = 1, limit = 25 } = req.query;
    const pageNum = Math.max(1, parseInt(page as string, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit as string, 10) || 25));
    const offset = (pageNum - 1) * limitNum;
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (action) { params.push(action); conditions.push('action = $' + params.length); }
    if (entityType) { params.push(entityType); conditions.push('entity_type = $' + params.length); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const count = await postgresQuery<{total:string|number}>(`SELECT COUNT(*) AS total FROM admin_audit_logs ${where}`, params);
    const rows = await postgresQuery(`
      SELECT id, admin_id AS "adminId", admin_username AS "adminUsername", action,
        entity_type AS "entityType", entity_id AS "entityId", summary,
        ip_address AS "ipAddress", created_at AS "createdAt"
      FROM admin_audit_logs ${where} ORDER BY created_at DESC
      LIMIT $${params.length+1} OFFSET $${params.length+2}
    `, [...params, limitNum, offset]);
    const total = Number(count.rows[0]?.total ?? 0);
    return res.json({ success:true, logs:rows.rows, pagination:{ total, page:pageNum, limit:limitNum, totalPages:Math.ceil(total/limitNum) } });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] GET /audit-logs:', err);
    return res.status(500).json({ error:'Failed to retrieve audit logs' });
  }
});

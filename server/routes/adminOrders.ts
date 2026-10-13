import { Router } from 'express';
import { postgresQuery } from '../postgres';
import { requireAuth, requireRole, logAudit } from '../auth';
import type { AuthenticatedRequest } from '../auth';

export const adminOrdersRouter = Router();

adminOrdersRouter.use(requireAuth);

adminOrdersRouter.get('/', requireRole(['owner', 'manager', 'viewer']), async (req: AuthenticatedRequest, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const offset = (page - 1) * limit;
    const status = req.query.status as string | undefined;
    const search = req.query.search as string | undefined;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status && status !== 'all') {
      params.push(status);
      conditions.push(`payment_status = $${params.length}`);
    }
    if (search) {
      params.push(`%${search}%`);
      const p = params.length;
      conditions.push(`(order_ref ILIKE $${p} OR masked_mobile ILIKE $${p} OR provider_name ILIKE $${p})`);
    }
    const whereClause = conditions.length ? conditions.join(' AND ') : 'TRUE';
    const count = await postgresQuery<{ c: string | number }>(
      `SELECT COUNT(*) AS c FROM recharge_orders WHERE ${whereClause}`, params
    );
    const total = Number(count.rows[0]?.c || 0);
    const orderParams = [...params, limit, offset];
    const orders = await postgresQuery(
      `SELECT id, order_ref, masked_mobile, provider_id, provider_name, plan_id, plan_price, plan_snapshot,
              payment_method, upi_id, payment_status, payment_started_at, customer_confirmed_at, admin_verified_by,
              admin_verified_at, admin_notes, created_at, updated_at
       FROM recharge_orders WHERE ${whereClause}
       ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      orderParams
    );
    const parsedOrders = orders.rows.map((o: any) => ({
      ...o,
      planSnapshot: typeof o.plan_snapshot === 'string' ? (() => { try { return JSON.parse(o.plan_snapshot); } catch { return {}; } })() : (o.plan_snapshot || {}),
    }));
    return res.json({ success: true, orders: parsedOrders, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] GET /orders:', err);
    return res.status(500).json({ error: 'Failed to retrieve orders.' });
  }
});

adminOrdersRouter.get('/stats', requireRole(['owner', 'manager', 'viewer']), async (_req: AuthenticatedRequest, res) => {
  try {
    const result = await postgresQuery(`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE payment_status IN ('pending_verification', 'pending', 'submitted_for_review'))::int AS pending_verification,
        COUNT(*) FILTER (WHERE payment_status = 'paid')::int AS paid,
        COUNT(*) FILTER (WHERE payment_status = 'failed')::int AS failed,
        COUNT(*) FILTER (WHERE payment_status = 'cancelled')::int AS cancelled,
        COALESCE(SUM(plan_price) FILTER (WHERE payment_status = 'paid'), 0)::numeric AS "totalRevenue"
      FROM recharge_orders
    `);
    return res.json({ success: true, stats: result.rows[0] || { total: 0, pending_verification: 0, paid: 0, failed: 0, cancelled: 0, totalRevenue: 0 } });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] GET /orders/stats:', err);
    return res.status(500).json({ error: 'Failed to retrieve order stats.' });
  }
});

adminOrdersRouter.patch('/:id/status', requireRole(['owner', 'manager']), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const { status, notes } = req.body;
    const validStatuses = ['pending_verification', 'pending', 'submitted_for_review', 'paid', 'failed', 'cancelled'];
    if (!status || !validStatuses.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` });
    }
    const found = await postgresQuery<{ id: string; order_ref: string; payment_status: string; masked_mobile: string; plan_price: number }>(
      'SELECT id, order_ref, payment_status, masked_mobile, plan_price FROM recharge_orders WHERE id = $1', [id]
    );
    const order = found.rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    const now = new Date().toISOString();
    await postgresQuery(
      `UPDATE recharge_orders
       SET payment_status = $1,
           admin_verified_by = CASE WHEN $1 = 'paid' THEN $2 ELSE admin_verified_by END,
           admin_verified_at = CASE WHEN $1 = 'paid' THEN $3 ELSE admin_verified_at END,
           admin_notes = COALESCE($4, admin_notes),
           updated_at = $3
       WHERE id = $5`,
      [status, req.admin!.username, now, notes || null, id]
    );
    await logAudit(
      req.admin, 'ORDER_STATUS_UPDATE', 'RECHARGE_ORDER', id,
      `Order ${order.order_ref} (${order.masked_mobile}, ₹${order.plan_price}) status changed from "${order.payment_status}" to "${status}" by ${req.admin!.username}${notes ? `. Notes: ${notes}` : ''}`,
      req
    );
    return res.json({ success: true, message: `Order status updated to "${status}"`, previousStatus: order.payment_status, newStatus: status });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] PATCH /orders/:id/status:', err);
    return res.status(500).json({ error: 'Failed to update order status.' });
  }
});

adminOrdersRouter.get('/:id', requireRole(['owner', 'manager', 'viewer']), async (req: AuthenticatedRequest, res) => {
  try {
    const { id } = req.params;
    const result = await postgresQuery('SELECT * FROM recharge_orders WHERE id = $1 OR order_ref = $1 LIMIT 1', [id]);
    const order: any = result.rows[0];
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    const planSnapshot = typeof order.plan_snapshot === 'string' ? (() => { try { return JSON.parse(order.plan_snapshot); } catch { return {}; } })() : (order.plan_snapshot || {});
    return res.json({ success: true, order: { ...order, planSnapshot } });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] GET /orders/:id:', err);
    return res.status(500).json({ error: 'Failed to retrieve order.' });
  }
});

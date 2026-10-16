import { Router } from 'express';
import { dbAdapter } from '../dbAdapter';
import { requireAuth } from '../auth';

export const adminStatsRouter = Router();

adminStatsRouter.use(requireAuth);

// GET /api/admin/stats/dashboard - Dashboard summary cards & metrics
adminStatsRouter.get('/dashboard', async (_req, res) => {
  try {
    const totalProvidersRow = await dbAdapter.queryOne<{ c: number }>('SELECT COUNT(*) as c FROM network_providers');
    const activeProvidersRow = await dbAdapter.queryOne<{ c: number }>('SELECT COUNT(*) as c FROM network_providers WHERE is_active = 1');

    const totalPlansRow = await dbAdapter.queryOne<{ c: number }>('SELECT COUNT(*) as c FROM recharge_plans');
    const publishedPlansRow = await dbAdapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM recharge_plans WHERE status = 'published'");
    const hiddenPlansRow = await dbAdapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM recharge_plans WHERE status = 'hidden'");
    const archivedPlansRow = await dbAdapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM recharge_plans WHERE status = 'archived'");

    const activeOffersRow = await dbAdapter.queryOne<{ c: number }>("SELECT COUNT(*) as c FROM special_offers WHERE status = 'active'");

    const totalSubmissionsRow = await dbAdapter.queryOne<{ c: number }>('SELECT COUNT(*) as c FROM customer_submissions');
    const submissionsTodayRow = await dbAdapter.queryOne<{ c: number }>(`
      SELECT COUNT(*) as c FROM customer_submissions 
      WHERE date(created_at) = date('now')
    `);

    const submissions7DaysRow = await dbAdapter.queryOne<{ c: number }>(`
      SELECT COUNT(*) as c FROM customer_submissions 
      WHERE created_at >= datetime('now', '-7 days')
    `);

    // Recent activity logs (sanitized, no passwords, no full phone numbers)
    const recentActivityRes = await dbAdapter.query(`
      SELECT id, admin_username as "adminUsername", action, entity_type as "entityType", entity_id as "entityId", summary, created_at as "createdAt"
      FROM admin_audit_logs
      ORDER BY created_at DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      stats: {
        totalProviders: Number(totalProvidersRow?.c ?? 0),
        activeProviders: Number(activeProvidersRow?.c ?? 0),
        totalPlans: Number(totalPlansRow?.c ?? 0),
        publishedPlans: Number(publishedPlansRow?.c ?? 0),
        hiddenPlans: Number(hiddenPlansRow?.c ?? 0),
        archivedPlans: Number(archivedPlansRow?.c ?? 0),
        activeOffers: Number(activeOffersRow?.c ?? 0),
        totalSubmissions: Number(totalSubmissionsRow?.c ?? 0),
        submissionsToday: Number(submissionsTodayRow?.c ?? 0),
        submissions7Days: Number(submissions7DaysRow?.c ?? 0),
      },
      recentActivity: recentActivityRes.rows,
    });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] GET /stats/dashboard:', err);
    res.status(500).json({ error: 'Failed to retrieve dashboard metrics' });
  }
});

// GET /api/admin/stats/reports - Analytics reports
adminStatsRouter.get('/reports', async (_req, res) => {
  try {
    // 1. Submissions by Operator
    const submissionsByOperatorRes = await dbAdapter.query(`
      SELECT p.name, p.brand_color as "brandColor", COUNT(s.id) as count
      FROM network_providers p
      LEFT JOIN customer_submissions s ON p.id = s.provider_id
      GROUP BY p.id
      ORDER BY count DESC
    `);

    // 2. Submissions per day for the last 14 days
    const submissionsByDayRes = await dbAdapter.query(`
      SELECT date(created_at) as date, COUNT(id) as count
      FROM customer_submissions
      WHERE created_at >= datetime('now', '-14 days')
      GROUP BY date(created_at)
      ORDER BY date ASC
    `);

    // 3. Plans by Provider
    const plansByProviderRes = await dbAdapter.query(`
      SELECT 
        p.name,
        p.brand_color as "brandColor",
        COUNT(rp.id) as "totalPlans",
        SUM(CASE WHEN rp.status = 'published' THEN 1 ELSE 0 END) as "publishedPlans",
        SUM(CASE WHEN rp.status = 'hidden' THEN 1 ELSE 0 END) as "hiddenPlans"
      FROM network_providers p
      LEFT JOIN recharge_plans rp ON p.id = rp.provider_id
      GROUP BY p.id
      ORDER BY p.display_order ASC
    `);

    // 4. Audit events distribution
    const auditEventsRes = await dbAdapter.query(`
      SELECT action, COUNT(id) as count
      FROM admin_audit_logs
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      reports: {
        submissionsByOperator: submissionsByOperatorRes.rows,
        submissionsByDay: submissionsByDayRes.rows,
        plansByProvider: plansByProviderRes.rows,
        auditEvents: auditEventsRes.rows,
      },
    });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] GET /stats/reports:', err);
    res.status(500).json({ error: 'Failed to retrieve reports' });
  }
});

import { Router } from 'express';
import { db } from '../db';
import { requireAuth } from '../auth';

export const adminStatsRouter = Router();

adminStatsRouter.use(requireAuth);

// GET /api/admin/stats/dashboard - Dashboard summary cards & metrics
adminStatsRouter.get('/dashboard', (_req, res) => {
  try {
    const totalProviders = (db.prepare('SELECT COUNT(*) as c FROM network_providers').get() as { c: number }).c;
    const activeProviders = (db.prepare('SELECT COUNT(*) as c FROM network_providers WHERE is_active = 1').get() as { c: number }).c;

    const totalPlans = (db.prepare('SELECT COUNT(*) as c FROM recharge_plans').get() as { c: number }).c;
    const publishedPlans = (db.prepare("SELECT COUNT(*) as c FROM recharge_plans WHERE status = 'published'").get() as { c: number }).c;
    const hiddenPlans = (db.prepare("SELECT COUNT(*) as c FROM recharge_plans WHERE status = 'hidden'").get() as { c: number }).c;
    const archivedPlans = (db.prepare("SELECT COUNT(*) as c FROM recharge_plans WHERE status = 'archived'").get() as { c: number }).c;

    const activeOffers = (db.prepare("SELECT COUNT(*) as c FROM special_offers WHERE status = 'active'").get() as { c: number }).c;

    const totalSubmissions = (db.prepare('SELECT COUNT(*) as c FROM customer_submissions').get() as { c: number }).c;
    const submissionsToday = (db.prepare(`
      SELECT COUNT(*) as c FROM customer_submissions 
      WHERE date(created_at) = date('now')
    `).get() as { c: number }).c;

    const submissions7Days = (db.prepare(`
      SELECT COUNT(*) as c FROM customer_submissions 
      WHERE created_at >= datetime('now', '-7 days')
    `).get() as { c: number }).c;

    // Recent activity logs (sanitized, no passwords, no full phone numbers)
    const recentActivity = db.prepare(`
      SELECT id, admin_username as adminUsername, action, entity_type as entityType, entity_id as entityId, summary, created_at as createdAt
      FROM admin_audit_logs
      ORDER BY created_at DESC
      LIMIT 10
    `).all();

    res.json({
      success: true,
      stats: {
        totalProviders,
        activeProviders,
        totalPlans,
        publishedPlans,
        hiddenPlans,
        archivedPlans,
        activeOffers,
        totalSubmissions,
        submissionsToday,
        submissions7Days,
      },
      recentActivity,
    });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] GET /stats/dashboard:', err);
    res.status(500).json({ error: 'Failed to retrieve dashboard metrics' });
  }
});

// GET /api/admin/stats/reports - Analytics reports
adminStatsRouter.get('/reports', (_req, res) => {
  try {
    // 1. Submissions by Operator
    const submissionsByOperator = db.prepare(`
      SELECT p.name, p.brand_color as brandColor, COUNT(s.id) as count
      FROM network_providers p
      LEFT JOIN customer_submissions s ON p.id = s.provider_id
      GROUP BY p.id
      ORDER BY count DESC
    `).all();

    // 2. Submissions per day for the last 14 days
    const submissionsByDay = db.prepare(`
      SELECT date(created_at) as date, COUNT(id) as count
      FROM customer_submissions
      WHERE created_at >= datetime('now', '-14 days')
      GROUP BY date(created_at)
      ORDER BY date ASC
    `).all();

    // 3. Plans by Provider
    const plansByProvider = db.prepare(`
      SELECT 
        p.name,
        p.brand_color as brandColor,
        COUNT(rp.id) as totalPlans,
        SUM(CASE WHEN rp.status = 'published' THEN 1 ELSE 0 END) as publishedPlans,
        SUM(CASE WHEN rp.status = 'hidden' THEN 1 ELSE 0 END) as hiddenPlans
      FROM network_providers p
      LEFT JOIN recharge_plans rp ON p.id = rp.provider_id
      GROUP BY p.id
      ORDER BY p.display_order ASC
    `).all();

    // 4. Audit events distribution
    const auditEvents = db.prepare(`
      SELECT action, COUNT(id) as count
      FROM admin_audit_logs
      GROUP BY action
      ORDER BY count DESC
      LIMIT 10
    `).all();

    res.json({
      success: true,
      reports: {
        submissionsByOperator,
        submissionsByDay,
        plansByProvider,
        auditEvents,
      },
    });
  } catch (err) {
    console.error('[ADMIN_API_ERROR] GET /stats/reports:', err);
    res.status(500).json({ error: 'Failed to retrieve reports' });
  }
});

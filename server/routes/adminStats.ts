import { Router } from 'express';
import { postgresQuery } from '../postgres';
import { requireAuth } from '../auth';

export const adminStatsRouter = Router();
adminStatsRouter.use(requireAuth);

adminStatsRouter.get('/dashboard', async (_req, res) => {
  try {
    const [providers, activeProviders, plans, published, hidden, archived, offers, submissions, today, week, activity] = await Promise.all([
      postgresQuery<{c:string|number}>('SELECT COUNT(*) AS c FROM network_providers'),
      postgresQuery<{c:string|number}>('SELECT COUNT(*) AS c FROM network_providers WHERE is_active = TRUE'),
      postgresQuery<{c:string|number}>('SELECT COUNT(*) AS c FROM recharge_plans'),
      postgresQuery<{c:string|number}>("SELECT COUNT(*) AS c FROM recharge_plans WHERE status = 'published'"),
      postgresQuery<{c:string|number}>("SELECT COUNT(*) AS c FROM recharge_plans WHERE status = 'hidden'"),
      postgresQuery<{c:string|number}>("SELECT COUNT(*) AS c FROM recharge_plans WHERE status = 'archived'"),
      postgresQuery<{c:string|number}>("SELECT COUNT(*) AS c FROM special_offers WHERE status = 'active'"),
      postgresQuery<{c:string|number}>('SELECT COUNT(*) AS c FROM customer_submissions'),
      postgresQuery<{c:string|number}>("SELECT COUNT(*) AS c FROM customer_submissions WHERE created_at >= CURRENT_DATE AND created_at < CURRENT_DATE + INTERVAL '1 day'"),
      postgresQuery<{c:string|number}>("SELECT COUNT(*) AS c FROM customer_submissions WHERE created_at >= NOW() - INTERVAL '7 days'"),
      postgresQuery('SELECT id, admin_username AS "adminUsername", action, entity_type AS "entityType", entity_id AS "entityId", summary, created_at AS "createdAt" FROM admin_audit_logs ORDER BY created_at DESC LIMIT 10')
    ]);
    const n = (r:{rows:{c:string|number}[]}) => Number(r.rows[0]?.c ?? 0);
    return res.json({ success:true, stats:{
      totalProviders:n(providers), activeProviders:n(activeProviders), totalPlans:n(plans),
      publishedPlans:n(published), hiddenPlans:n(hidden), archivedPlans:n(archived),
      activeOffers:n(offers), totalSubmissions:n(submissions), submissionsToday:n(today), submissions7Days:n(week)
    }, recentActivity:activity.rows });
  } catch (err) { console.error('[ADMIN_API_ERROR] GET /stats/dashboard:', err); return res.status(500).json({ error:'Failed to retrieve dashboard metrics' }); }
});

adminStatsRouter.get('/reports', async (_req, res) => {
  try {
    const [submissionsByOperator, submissionsByDay, plansByProvider, auditEvents] = await Promise.all([
      postgresQuery(`SELECT p.name, p.brand_color AS "brandColor", COUNT(s.id)::int AS count
        FROM network_providers p LEFT JOIN customer_submissions s ON p.id = s.provider_id
        GROUP BY p.id ORDER BY count DESC`),
      postgresQuery(`SELECT created_at::date AS date, COUNT(id)::int AS count FROM customer_submissions
        WHERE created_at >= NOW() - INTERVAL '14 days' GROUP BY created_at::date ORDER BY date ASC`),
      postgresQuery(`SELECT p.name, p.brand_color AS "brandColor", COUNT(rp.id)::int AS "totalPlans",
        COUNT(rp.id) FILTER (WHERE rp.status = 'published')::int AS "publishedPlans",
        COUNT(rp.id) FILTER (WHERE rp.status = 'hidden')::int AS "hiddenPlans"
        FROM network_providers p LEFT JOIN recharge_plans rp ON p.id = rp.provider_id
        GROUP BY p.id ORDER BY p.display_order ASC`),
      postgresQuery('SELECT action, COUNT(id)::int AS count FROM admin_audit_logs GROUP BY action ORDER BY count DESC LIMIT 10')
    ]);
    return res.json({ success:true, reports:{ submissionsByOperator:submissionsByOperator.rows, submissionsByDay:submissionsByDay.rows, plansByProvider:plansByProvider.rows, auditEvents:auditEvents.rows } });
  } catch (err) { console.error('[ADMIN_API_ERROR] GET /stats/reports:', err); return res.status(500).json({ error:'Failed to retrieve reports' }); }
});

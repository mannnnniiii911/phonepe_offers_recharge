import { Router } from 'express';
import crypto from 'crypto';
import { postgresQuery } from '../postgres';
import { recordSupabasePaymentClick } from '../supabase';

export const paymentClicksRouter = Router();
const VALID_PAYMENT_OPTIONS = ['phonepe', 'google_pay', 'qr_code', 'paytm'] as const;
type ValidPaymentOption = (typeof VALID_PAYMENT_OPTIONS)[number];

paymentClicksRouter.post('/payment-clicks', async (req, res) => {
  try {
    const { paymentOption, orderId, sessionId } = req.body ?? {};
    if (!paymentOption || typeof paymentOption !== 'string') return res.status(400).json({ error:'Missing paymentOption parameter.' });
    const normalized = paymentOption.toLowerCase().trim() as ValidPaymentOption;
    if (!VALID_PAYMENT_OPTIONS.includes(normalized)) return res.status(400).json({ error:`Invalid paymentOption '${paymentOption}'. Must be one of: ${VALID_PAYMENT_OPTIONS.join(', ')}` });
    const eventId = crypto.randomUUID();
    const now = new Date().toISOString();
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]) || req.socket?.remoteAddress || '';
    const userAgent = (req.headers['user-agent'] as string) || '';
    const safeOrderId = typeof orderId === 'string' && orderId.trim() ? orderId.trim() : null;
    const safeSessionId = typeof sessionId === 'string' && sessionId.trim() ? sessionId.trim() : null;
    await postgresQuery(`
      INSERT INTO payment_click_events (id,order_id,session_id,payment_option,clicked_at,client_ip,user_agent,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    `, [eventId,safeOrderId,safeSessionId,normalized,now,clientIp,userAgent,now]);
    recordSupabasePaymentClick({ id:eventId, order_id:safeOrderId, session_id:safeSessionId, payment_option:normalized, clicked_at:now, client_ip:clientIp, user_agent:userAgent })
      .catch(err => console.warn('[Supabase Sync Warning]:', err?.message || err));
    return res.status(201).json({ success:true, eventId, paymentOption:normalized, orderId:safeOrderId, sessionId:safeSessionId, clickedAt:now });
  } catch (error) {
    console.error('[API_ERROR] POST /payment-clicks:', error);
    return res.status(500).json({ error:'Internal tracking error' });
  }
});

paymentClicksRouter.post('/track/payment-click', (req, res, next) => {
  req.url = '/payment-clicks';
  return paymentClicksRouter.handle(req, res, next);
});

paymentClicksRouter.get('/payment-clicks', async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 50));
    const result = await postgresQuery(`
      SELECT id, order_id, session_id, payment_option, clicked_at, created_at
      FROM payment_click_events ORDER BY clicked_at DESC LIMIT $1
    `, [limit]);
    return res.json({ success:true, count:result.rows.length, events:result.rows });
  } catch (error) {
    console.error('[API_ERROR] GET /payment-clicks:', error);
    return res.status(500).json({ error:'Failed to fetch payment click events' });
  }
});

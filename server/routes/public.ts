import { Router } from 'express';
import { postgresQuery } from '../postgres';
import crypto from 'crypto';
import { getPersistentPaymentSettings, isSupabasePaymentSettingsConfigured } from '../supabasePaymentSettings';

export const publicRouter = Router();

publicRouter.get('/providers', async (_req, res) => {
  try {
    const result = await postgresQuery(`
      SELECT id, slug, name, brand_color AS "brandColor", badge_bg AS "badgeBg",
        text_color AS "textColor", tagline, logo_url AS "logoUrl", description
      FROM network_providers WHERE is_active = TRUE ORDER BY display_order ASC, name ASC
    `);
    return res.json({ success:true, providers:result.rows });
  } catch (err) { console.error('[API_ERROR] GET /api/providers:', err); return res.status(500).json({ error:'Failed to retrieve providers' }); }
});

publicRouter.get('/plans', async (req, res) => {
  try {
    const { providerId, operatorId } = req.query;
    const targetProvider = (providerId || operatorId) as string | undefined;
    const params: unknown[] = [];
    let query = `
      SELECT id, provider_id AS "operatorId", price, original_price AS "originalPrice",
        validity, data_allowance AS data, voice, sms, tag, category, status, display_order
      FROM recharge_plans WHERE status = 'published'
    `;
    if (targetProvider) { params.push(targetProvider); query += ' AND provider_id = $1'; }
    query += ' ORDER BY price DESC';
    const result = await postgresQuery(query, params);
    return res.json({ success:true, plans:result.rows });
  } catch (err) { console.error('[API_ERROR] GET /api/plans:', err); return res.status(500).json({ error:'Failed to retrieve plans' }); }
});

publicRouter.get('/offers/active', async (_req, res) => {
  try {
    const result = await postgresQuery<{
      id:string;title:string;message:string;subtitle:string;bannerUrl:string;timerMode:string;
      startTime:string;endTime:string;durationMinutes:number;status:string;
    }>(`
      SELECT id,title,message,subtitle,banner_url AS "bannerUrl",timer_mode AS "timerMode",
        start_time AS "startTime",end_time AS "endTime",duration_minutes AS "durationMinutes",status
      FROM special_offers WHERE status = 'active' ORDER BY display_order ASC LIMIT 1
    `);
    const offer = result.rows[0];
    if (!offer) return res.json({ success:true, offer:null });
    const now = new Date();
    const endTimestamp = new Date(offer.endTime).getTime();
    if (endTimestamp <= now.getTime()) {
      await postgresQuery("UPDATE special_offers SET status = 'expired', updated_at = $1 WHERE id = $2", [now.toISOString(), offer.id]);
      return res.json({ success:true, offer:{ ...offer, status:'expired', remainingSeconds:0, serverNow:now.toISOString() } });
    }
    return res.json({ success:true, offer:{ ...offer, remainingSeconds:Math.max(0, Math.floor((endTimestamp-now.getTime())/1000)), serverNow:now.toISOString() } });
  } catch (err) { console.error('[API_ERROR] GET /api/offers/active:', err); return res.status(500).json({ error:'Failed to retrieve active offer' }); }
});

publicRouter.get('/settings', async (_req, res) => {
  try {
    const result = await postgresQuery<{setting_key:string;setting_value:string}>('SELECT setting_key, setting_value FROM website_settings');
    const settings: Record<string,string> = {};
    for (const row of result.rows) settings[row.setting_key] = row.setting_value;
    if (isSupabasePaymentSettingsConfigured()) Object.assign(settings, await getPersistentPaymentSettings());
    return res.json({ success:true, settings:{
      siteTitle:settings.site_title || 'PhonePe Recharges',
      bannerHeadline:settings.banner_headline || 'BEST SAVINGS OFFERS!',
      bannerSubtitle:settings.banner_subtitle || 'Save up to 80% on annual & 5G recharge packs',
      countdownLabel:settings.countdown_label || 'Special Offer Ends In',
      countdownVisible:settings.countdown_visible !== 'false', bannerVisible:settings.banner_visible !== 'false',
      announcementBar:settings.announcement_bar || '',
      privacyNoticeText:settings.privacy_notice_text || 'By entering your number, you consent to processing your mobile number and operator for recharge estimation.',
      privacyNoticeVersion:settings.privacy_notice_version || 'v1.0',
      customerSupportContact:settings.customer_support_contact || settings.support_contact || '',
      upiId:settings.upi_id || 'sujalshaw8902@nyes', qrCodeUrl:settings.qr_code_url || '/assets/upi-qr.jpg',
    }});
  } catch (err) { console.error('[API_ERROR] GET /api/settings:', err); return res.status(500).json({ error:'Failed to retrieve website settings' }); }
});

publicRouter.post('/submissions', async (req, res) => {
  try {
    const { mobileNumber, providerId, planId, consentVersion } = req.body ?? {};
    if (!providerId) return res.status(400).json({ error:'Network provider selection is required.' });
    if (!mobileNumber) return res.status(400).json({ error:'Mobile number is required.' });
    const cleanedNumber = String(mobileNumber).replace(/\D/g, '');
    const tenDigit = cleanedNumber.length === 12 && cleanedNumber.startsWith('91') ? cleanedNumber.slice(2) : cleanedNumber;
    if (tenDigit.length !== 10 || !/^[6-9]\d{9}$/.test(tenDigit)) return res.status(400).json({ error:'Please enter a valid 10-digit Indian mobile number starting with 6, 7, 8, or 9.' });

    const providerResult = await postgresQuery<{id:string;name:string;is_active:boolean}>('SELECT id,name,is_active FROM network_providers WHERE id = $1', [providerId]);
    const provider = providerResult.rows[0];
    if (!provider || provider.is_active !== true) return res.status(400).json({ error:'The selected network provider is currently unavailable.' });

    let planSnapshot: string | null = null;
    if (planId) {
      const planResult = await postgresQuery('SELECT * FROM recharge_plans WHERE id = $1', [planId]);
      if (planResult.rows[0]) planSnapshot = JSON.stringify(planResult.rows[0]);
    }
    const forwarded = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0]) || req.socket.remoteAddress || '127.0.0.1';
    const submissionId = 'sub-' + crypto.randomUUID();
    const duplicate = await postgresQuery<{id:string}>(`
      SELECT id FROM customer_submissions
      WHERE mobile_number = $1 AND provider_id = $2 AND created_at >= NOW() - INTERVAL '10 seconds'
      ORDER BY created_at DESC LIMIT 1
    `, [tenDigit, provider.id]);
    if (duplicate.rows[0]) return res.json({ success:true, submissionId:duplicate.rows[0].id, message:'Submission already recorded' });

    await postgresQuery(`
      INSERT INTO customer_submissions (id,mobile_number,provider_id,provider_name,plan_id,plan_snapshot,status,consent_version,client_ip,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,'submitted',$7,$8,$9)
    `, [submissionId, tenDigit, provider.id, provider.name, planId || null, planSnapshot, consentVersion || 'v1.0', ip, new Date().toISOString()]);
    return res.json({ success:true, submissionId, message:'Mobile number and operator selection recorded securely.' });
  } catch (err) { console.error('[API_ERROR] POST /api/submissions:', err); return res.status(500).json({ error:'Failed to record submission' }); }
});

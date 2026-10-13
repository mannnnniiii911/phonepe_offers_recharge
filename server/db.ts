import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { postgresPool } from './postgres';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function initDatabase(): Promise<void> {
  const schemaPath = path.join(here, 'migrations', '001_postgres_schema.sql');
  const schema = await fs.readFile(schemaPath, 'utf8');
  // Idempotent CREATE TABLE/INDEX statements; existing PostgreSQL data is preserved.
  await postgresPool.query(schema);
  await seedInitialData();
  console.log('[POSTGRES] Database schema and default records are ready.');
}

async function seedInitialData(): Promise<void> {
  const now = new Date().toISOString();

  const owner = await postgresPool.query('SELECT id FROM admin_users WHERE username = $1 LIMIT 1', ['admin']);
  if (owner.rowCount === 0) {
    const password = process.env.ADMIN_INITIAL_PASSWORD || 'AdminPassword@2026!';
    const passwordHash = bcrypt.hashSync(password, bcrypt.genSaltSync(12));
    await postgresPool.query(
      `INSERT INTO admin_users (id, username, email, password_hash, role, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`,
      ['admin-owner-001', 'admin', 'admin@phonepe-recharge.local', passwordHash, 'owner', 'active', now, now]
    );
    console.log('[POSTGRES] Initial owner record checked. Set ADMIN_INITIAL_PASSWORD in the deployment environment.');
  }

  const providers = [
    { id: 'jio', slug: 'jio', name: 'Jio', brand: '#E11D48', badge: '#FEE2E2', text: '#FFFFFF', tagline: 'True 5G Network', logo: '/assets/logos/jio.svg', description: 'Reliance Jio Infocomm Limited', order: 1 },
    { id: 'airtel', slug: 'airtel', name: 'Airtel', brand: '#ED1C24', badge: '#FEE2E2', text: '#ED1C24', tagline: 'Airtel 5G Plus', logo: '/assets/logos/airtel.svg', description: 'Bharti Airtel Limited', order: 2 },
    { id: 'vi', slug: 'vi', name: 'Vi', brand: '#ED303B', badge: '#FFE4E6', text: '#ED303B', tagline: 'Vi Hero Unlimited', logo: '/assets/logos/vi.svg', description: 'Vodafone Idea Limited', order: 3 },
    { id: 'bsnl', slug: 'bsnl', name: 'BSNL', brand: '#00598E', badge: '#E0F2FE', text: '#00598E', tagline: 'Connecting India 4G', logo: '/assets/logos/bsnl.svg', description: 'Bharat Sanchar Nigam Limited', order: 4 },
  ];
  const providerCount = await postgresPool.query('SELECT COUNT(*)::int AS c FROM network_providers');
  if (Number(providerCount.rows[0]?.c || 0) === 0) {
    for (const p of providers) {
      await postgresPool.query(
        `INSERT INTO network_providers (id,slug,name,brand_color,badge_bg,text_color,tagline,logo_url,description,is_active,display_order,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,TRUE,$10,$11,$11) ON CONFLICT DO NOTHING`,
        [p.id,p.slug,p.name,p.brand,p.badge,p.text,p.tagline,p.logo,p.description,p.order,now]
      );
    }
  }

  const defaultPlans = [
    ['jio-499','jio',499,3999,'365 Days','3GB/day','UNLIMITED TRUE 5G DATA','popular',1],
    ['jio-449','jio',449,2495,'365 Days','2.5GB/day','UNLIMITED TRUE 5G DATA','5g',2],
    ['jio-399','jio',399,1999,'180 Days','2GB/day','UNLIMITED TRUE 5G DATA','popular',3],
    ['jio-299','jio',299,1499,'84 Days','2GB/day','UNLIMITED TRUE 5G DATA','popular',4],
    ['jio-239','jio',239,999,'30 Days','1.5GB/day','UNLIMITED TRUE 5G DATA','data',5],
    ['jio-199','jio',199,799,'28 Days','1.5GB/day','','validity',6],
    ['airtel-499','airtel',499,3999,'365 Days','3GB/day','UNLIMITED 5G PLUS DATA','popular',1],
    ['airtel-399','airtel',399,1999,'180 Days','2GB/day','UNLIMITED 5G PLUS DATA','popular',2],
    ['airtel-299','airtel',299,1499,'84 Days','2GB/day','UNLIMITED 5G PLUS DATA','popular',3],
    ['airtel-199','airtel',199,799,'28 Days','1.5GB/day','','validity',4],
    ['vi-499','vi',499,3999,'365 Days','3GB/day','BINGE ALL NIGHT DATA','popular',1],
    ['vi-399','vi',399,1999,'180 Days','2GB/day','WEEKEND DATA ROLLOVER','popular',2],
    ['vi-299','vi',299,1499,'84 Days','2GB/day','HERO UNLIMITED','popular',3],
    ['bsnl-499','bsnl',499,3999,'365 Days','3GB/day','BSNL SUPER 4G PACK','popular',1],
    ['bsnl-299','bsnl',299,1499,'84 Days','2GB/day','','popular',2],
  ] as const;
  const planCount = await postgresPool.query('SELECT COUNT(*)::int AS c FROM recharge_plans');
  if (Number(planCount.rows[0]?.c || 0) === 0) {
    for (const p of defaultPlans) {
      await postgresPool.query(
        `INSERT INTO recharge_plans (id,provider_id,price,original_price,validity,data_allowance,voice,sms,tag,category,status,display_order,created_at,updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,'Unlimited','100/day',$7,$8,'published',$9,$10,$10) ON CONFLICT DO NOTHING`,
        [p[0],p[1],p[2],p[3],p[4],p[5],p[6],p[7],p[8],now]
      );
    }
  }

  const offerCount = await postgresPool.query('SELECT COUNT(*)::int AS c FROM special_offers');
  if (Number(offerCount.rows[0]?.c || 0) === 0) {
    const start = new Date();
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    await postgresPool.query(
      `INSERT INTO special_offers (id,title,message,subtitle,banner_url,timer_mode,start_time,end_time,duration_minutes,status,display_order,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',1,$10,$10) ON CONFLICT DO NOTHING`,
      ['offer-festive-2026','BEST SAVINGS OFFERS!','Special 5G Unlimited Recharge Flash Sale','Save up to 80% with PhonePe Recharge Bonus','','duration',start.toISOString(),end.toISOString(),30,now]
    );
  }

  const defaults: Record<string,string> = {
    site_title: 'PhonePe Recharges',
    banner_headline: 'BEST SAVINGS OFFERS!',
    banner_subtitle: 'Save up to 80% on annual & 5G recharge packs',
    countdown_label: 'Special Offer Ends In',
    countdown_visible: 'true',
    banner_visible: 'true',
    announcement_bar: 'Special Festive Recharge Discount Active',
    privacy_notice_version: 'v1.0',
    privacy_notice_text: 'By entering your number, you consent to processing your mobile number and selected operator solely for mobile recharge service estimation and verification.',
    retention_days: '90',
    timezone: 'Asia/Kolkata',
    table_page_size: '10',
    upi_id: 'q462939567@ybl',
    qr_code_url: '/assets/upi-qr.jpg',
  };
  for (const [key,value] of Object.entries(defaults)) {
    await postgresPool.query(
      `INSERT INTO website_settings (setting_key,setting_value,updated_at,updated_by)
       VALUES ($1,$2,$3,'system') ON CONFLICT (setting_key) DO NOTHING`,
      [key,value,now]
    );
  }

  await postgresPool.query(
    `INSERT INTO admin_audit_logs (id,admin_id,admin_username,action,entity_type,entity_id,summary,ip_address,created_at)
     VALUES ($1,'system','system','SYSTEM_INIT','DATABASE','ALL',$2,'127.0.0.1',$3) ON CONFLICT (id) DO NOTHING`,
    ['audit-init-001','Initialized PostgreSQL database with default operators, plans, settings, and owner user',now]
  );
}

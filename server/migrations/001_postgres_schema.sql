-- PostgreSQL schema for the independent recharge service.
-- Apply only after backing up the existing database. This file does not delete data.
CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'manager',
  status TEXT NOT NULL DEFAULT 'active', created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS network_providers (
  id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  brand_color TEXT NOT NULL DEFAULT '#6426AD', badge_bg TEXT NOT NULL DEFAULT '#F2EAFE',
  text_color TEXT NOT NULL DEFAULT '#FFFFFF', tagline TEXT NOT NULL DEFAULT '',
  logo_url TEXT NOT NULL DEFAULT '', description TEXT DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE, display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS recharge_plans (
  id TEXT PRIMARY KEY, provider_id TEXT NOT NULL REFERENCES network_providers(id) ON DELETE RESTRICT,
  price NUMERIC NOT NULL, original_price NUMERIC NOT NULL, validity TEXT NOT NULL,
  data_allowance TEXT NOT NULL, voice TEXT NOT NULL DEFAULT 'Unlimited',
  sms TEXT NOT NULL DEFAULT '100/day', tag TEXT DEFAULT '',
  category TEXT NOT NULL DEFAULT 'popular', description TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'published', display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS special_offers (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, message TEXT NOT NULL, subtitle TEXT DEFAULT '',
  banner_url TEXT DEFAULT '', provider_id TEXT DEFAULT NULL, timer_mode TEXT NOT NULL DEFAULT 'duration',
  start_time TIMESTAMPTZ NOT NULL, end_time TIMESTAMPTZ NOT NULL, duration_minutes INTEGER NOT NULL DEFAULT 30,
  status TEXT NOT NULL DEFAULT 'active', display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_submissions (
  id TEXT PRIMARY KEY, mobile_number TEXT NOT NULL, provider_id TEXT NOT NULL,
  provider_name TEXT NOT NULL, plan_id TEXT DEFAULT NULL, plan_snapshot TEXT DEFAULT NULL,
  status TEXT NOT NULL DEFAULT 'submitted', consent_version TEXT NOT NULL DEFAULT 'v1.0',
  client_ip TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS website_settings (
  setting_key TEXT PRIMARY KEY, setting_value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL, updated_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS admin_audit_logs (
  id TEXT PRIMARY KEY, admin_id TEXT NOT NULL, admin_username TEXT NOT NULL,
  action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT DEFAULT '',
  summary TEXT NOT NULL, ip_address TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS recharge_orders (
  id TEXT PRIMARY KEY, order_ref TEXT UNIQUE NOT NULL, mobile_number_hash TEXT NOT NULL,
  masked_mobile TEXT NOT NULL, provider_id TEXT NOT NULL, provider_name TEXT NOT NULL,
  plan_id TEXT DEFAULT NULL, plan_price NUMERIC NOT NULL, plan_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  payment_method TEXT NOT NULL DEFAULT 'upi', upi_id TEXT NOT NULL,
  payment_status TEXT NOT NULL DEFAULT 'pending_verification', payment_started_at TIMESTAMPTZ DEFAULT NULL,
  customer_confirmed_at TIMESTAMPTZ DEFAULT NULL, admin_verified_by TEXT DEFAULT NULL,
  admin_verified_at TIMESTAMPTZ DEFAULT NULL, admin_notes TEXT DEFAULT '', client_ip TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON recharge_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_ref ON recharge_orders(order_ref);
CREATE INDEX IF NOT EXISTS idx_orders_created ON recharge_orders(created_at);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0,
  last_attempt BIGINT NOT NULL, blocked_until BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS payment_click_events (
  id TEXT PRIMARY KEY, order_id TEXT DEFAULT NULL, session_id TEXT DEFAULT NULL,
  payment_option TEXT NOT NULL, clicked_at TIMESTAMPTZ NOT NULL, client_ip TEXT DEFAULT '',
  user_agent TEXT DEFAULT '', created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_clicks_option ON payment_click_events(payment_option);
CREATE INDEX IF NOT EXISTS idx_payment_clicks_order ON payment_click_events(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_clicks_time ON payment_click_events(clicked_at);

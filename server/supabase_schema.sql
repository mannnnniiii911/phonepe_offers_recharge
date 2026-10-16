-- ==============================================================================
-- PhonePe Recharge: Complete PostgreSQL Schema for Supabase
-- Target: Supabase PostgreSQL (Run safely in Supabase SQL Editor on a new project)
-- Compatible with PostgreSQL 15+ & Supabase Row Level Security (RLS)
-- ==============================================================================

-- 1. Enable pgcrypto / uuid extension for ID generation if needed
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ------------------------------------------------------------------------------
-- Table 1: admin_users
-- Stores administrative user accounts with bcrypt password hashes
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'manager' CHECK (role IN ('owner', 'manager', 'viewer')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_users_username ON public.admin_users(username);
CREATE INDEX IF NOT EXISTS idx_admin_users_email ON public.admin_users(email);

-- ------------------------------------------------------------------------------
-- Table 2: network_providers
-- Supported telecom providers (Jio, Airtel, Vi, BSNL)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.network_providers (
    id TEXT PRIMARY KEY,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    brand_color TEXT NOT NULL DEFAULT '#6426AD',
    badge_bg TEXT NOT NULL DEFAULT '#F2EAFE',
    text_color TEXT NOT NULL DEFAULT '#FFFFFF',
    tagline TEXT NOT NULL DEFAULT '',
    logo_url TEXT NOT NULL DEFAULT '',
    description TEXT DEFAULT '',
    is_active BOOLEAN NOT NULL DEFAULT true,
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_network_providers_slug ON public.network_providers(slug);
CREATE INDEX IF NOT EXISTS idx_network_providers_order ON public.network_providers(display_order);

-- ------------------------------------------------------------------------------
-- Table 3: recharge_plans
-- Recharge packages per telecom provider
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recharge_plans (
    id TEXT PRIMARY KEY,
    provider_id TEXT NOT NULL REFERENCES public.network_providers(id) ON DELETE RESTRICT,
    price NUMERIC(10,2) NOT NULL,
    original_price NUMERIC(10,2) NOT NULL,
    validity TEXT NOT NULL,
    data_allowance TEXT NOT NULL,
    voice TEXT NOT NULL DEFAULT 'Unlimited',
    sms TEXT NOT NULL DEFAULT '100/day',
    tag TEXT DEFAULT '',
    category TEXT NOT NULL DEFAULT 'popular' CHECK (category IN ('popular', '5g', 'validity', 'data', 'all')),
    description TEXT DEFAULT '',
    status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'hidden', 'archived')),
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recharge_plans_provider ON public.recharge_plans(provider_id);
CREATE INDEX IF NOT EXISTS idx_recharge_plans_status ON public.recharge_plans(status);
CREATE INDEX IF NOT EXISTS idx_recharge_plans_category ON public.recharge_plans(category);

-- ------------------------------------------------------------------------------
-- Table 4: special_offers
-- Flash offers and promo banners with timer configuration
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.special_offers (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    subtitle TEXT DEFAULT '',
    banner_url TEXT DEFAULT '',
    provider_id TEXT DEFAULT NULL,
    timer_mode TEXT NOT NULL DEFAULT 'duration' CHECK (timer_mode IN ('fixed', 'duration')),
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL DEFAULT 30,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'expired')),
    display_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_special_offers_status ON public.special_offers(status);

-- ------------------------------------------------------------------------------
-- Table 5: customer_submissions
-- Leads and mobile recharge estimates entered by customers
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.customer_submissions (
    id TEXT PRIMARY KEY,
    mobile_number TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    plan_id TEXT DEFAULT NULL,
    plan_snapshot TEXT DEFAULT NULL,
    status TEXT NOT NULL DEFAULT 'submitted',
    consent_version TEXT NOT NULL DEFAULT 'v1.0',
    client_ip TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_customer_submissions_created ON public.customer_submissions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_customer_submissions_mobile ON public.customer_submissions(mobile_number);

-- ------------------------------------------------------------------------------
-- Table 6: website_settings
-- Dynamic website content & payment configuration (UPI ID, QR code image URL)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.website_settings (
    setting_key TEXT PRIMARY KEY,
    setting_value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by TEXT NOT NULL
);

-- ------------------------------------------------------------------------------
-- Table 7: admin_audit_logs
-- Immutable security audit log for admin operations
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.admin_audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL,
    admin_username TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT DEFAULT '',
    summary TEXT NOT NULL,
    ip_address TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_created ON public.admin_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON public.admin_audit_logs(admin_id);

-- ------------------------------------------------------------------------------
-- Table 8: recharge_orders
-- Central customer order & payment tracking ledger
-- Never automatically marks orders as paid; preserves pending_verification workflow
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.recharge_orders (
    id TEXT PRIMARY KEY,
    order_ref TEXT UNIQUE NOT NULL,
    mobile_number_hash TEXT NOT NULL,
    masked_mobile TEXT NOT NULL,
    provider_id TEXT NOT NULL,
    provider_name TEXT NOT NULL,
    plan_id TEXT DEFAULT NULL,
    plan_price NUMERIC(10,2) NOT NULL,
    plan_snapshot TEXT NOT NULL DEFAULT '{}',
    payment_method TEXT NOT NULL DEFAULT 'upi',
    upi_id TEXT NOT NULL,
    -- Status vocabulary must stay in sync with server/orderStatus.ts
    payment_status TEXT NOT NULL DEFAULT 'pending_verification'
        CHECK (payment_status IN (
            'pending_verification',
            'pending',
            'submitted_for_review',
            'paid',
            'failed',
            'cancelled'
        )),
    payment_started_at TIMESTAMPTZ DEFAULT NULL,
    customer_confirmed_at TIMESTAMPTZ DEFAULT NULL,
    admin_verified_by TEXT DEFAULT NULL,
    admin_verified_at TIMESTAMPTZ DEFAULT NULL,
    admin_notes TEXT DEFAULT '',
    client_ip TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_status ON public.recharge_orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_ref ON public.recharge_orders(order_ref);
CREATE INDEX IF NOT EXISTS idx_orders_created ON public.recharge_orders(created_at DESC);

-- ------------------------------------------------------------------------------
-- Table 9: login_attempts
-- Brute-force and rate-limiting tracking
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.login_attempts (
    ip TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_attempt BIGINT NOT NULL,
    blocked_until BIGINT NOT NULL DEFAULT 0
);

-- ------------------------------------------------------------------------------
-- Table 10: payment_click_events
-- Real-time analytics on payment option clicks (PhonePe, Paytm, QR, GPay)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_click_events (
    id TEXT PRIMARY KEY,
    order_id TEXT DEFAULT NULL,
    session_id TEXT DEFAULT NULL,
    payment_option TEXT NOT NULL CHECK (payment_option IN ('phonepe', 'google_pay', 'qr_code', 'paytm')),
    clicked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    client_ip TEXT DEFAULT '',
    user_agent TEXT DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_click_option ON public.payment_click_events(payment_option);
CREATE INDEX IF NOT EXISTS idx_payment_click_order ON public.payment_click_events(order_id);
CREATE INDEX IF NOT EXISTS idx_payment_click_time ON public.payment_click_events(clicked_at DESC);

-- ==============================================================================
-- Row Level Security (RLS) Policies
-- Protects sensitive customer data, orders, and credentials in Supabase
-- ==============================================================================

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.network_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recharge_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.special_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recharge_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_click_events ENABLE ROW LEVEL SECURITY;

-- 1. Service Role (Server Backend) has full unrestricted access to all tables
DO $$
DECLARE
    tbl text;
BEGIN
    FOR tbl IN 
        SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename IN (
            'admin_users', 'network_providers', 'recharge_plans', 'special_offers',
            'customer_submissions', 'website_settings', 'admin_audit_logs',
            'recharge_orders', 'login_attempts', 'payment_click_events'
        )
    LOOP
        EXECUTE format('DROP POLICY IF EXISTS "service_role_all_%I" ON public.%I', tbl, tbl);
        EXECUTE format('CREATE POLICY "service_role_all_%I" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', tbl, tbl);
    END LOOP;
END $$;

-- 2. Public / Anon access: Public read-only for catalog data only (providers, published plans, active offers)
-- NOTE: website_settings has NO anon/public policy. The Express backend serves settings via /api/settings.
DROP POLICY IF EXISTS "public_read_network_providers" ON public.network_providers;
CREATE POLICY "public_read_network_providers" ON public.network_providers FOR SELECT TO anon USING (is_active = true);

DROP POLICY IF EXISTS "public_read_recharge_plans" ON public.recharge_plans;
CREATE POLICY "public_read_recharge_plans" ON public.recharge_plans FOR SELECT TO anon USING (status = 'published');

DROP POLICY IF EXISTS "public_read_special_offers" ON public.special_offers;
CREATE POLICY "public_read_special_offers" ON public.special_offers FOR SELECT TO anon USING (status = 'active');

DROP POLICY IF EXISTS "public_read_website_settings" ON public.website_settings;

-- 3. Public / Anon insert for client tracking (customers cannot read, update, or delete tracking events)
DROP POLICY IF EXISTS "public_insert_payment_click_events" ON public.payment_click_events;
CREATE POLICY "public_insert_payment_click_events" ON public.payment_click_events FOR INSERT TO anon WITH CHECK (true);

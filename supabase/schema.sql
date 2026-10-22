-- ==============================================================================
-- POS & Sound Box Stock Inventory & Merchant CRM Schema for Supabase
-- Target Database: PostgreSQL 15+ / 16+
-- ==============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- 2. Branches Table
CREATE TABLE IF NOT EXISTS public.branches (
  id VARCHAR(16) PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(16) UNIQUE NOT NULL,
  region VARCHAR(80) DEFAULT 'Phnom Penh',
  manager VARCHAR(120),
  phone VARCHAR(32),
  address TEXT,
  staff JSONB DEFAULT '[]'::jsonb,
  active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Hardware Devices Table (POS Terminals & Sound Boxes)
CREATE TABLE IF NOT EXISTS public.devices (
  serial VARCHAR(64) PRIMARY KEY,
  type VARCHAR(32) NOT NULL CHECK (type IN ('POS Terminal', 'Sound Box')),
  model VARCHAR(64) NOT NULL,
  stage VARCHAR(32) NOT NULL DEFAULT 'HQ_STOCK',
  branch_id VARCHAR(16) REFERENCES public.branches(id) ON UPDATE CASCADE,
  branch_name VARCHAR(120),
  stock_in_date VARCHAR(32) NOT NULL DEFAULT CURRENT_DATE::text,
  deployed_date VARCHAR(32),
  battery_installed_date VARCHAR(32),
  battery_serial VARCHAR(64),
  redeploy_count INT DEFAULT 0,
  staff VARCHAR(120),
  merchant_name VARCHAR(160),
  merchant_phone VARCHAR(32),
  location VARCHAR(160),
  address TEXT,
  mid VARCHAR(32),
  tid VARCHAR(32),
  note TEXT,
  history JSONB DEFAULT '[]'::jsonb,
  archived BOOLEAN DEFAULT FALSE,
  custom_fields JSONB DEFAULT '{}'::jsonb,
  return_reason TEXT,
  deployment_status VARCHAR(64),
  stock_status VARCHAR(64),
  hours_in_stage INT DEFAULT 12,
  integrity_hash VARCHAR(128),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Performance Indexes on Devices
CREATE INDEX IF NOT EXISTS idx_devices_branch_stage ON public.devices(branch_id, stage);
CREATE INDEX IF NOT EXISTS idx_devices_stage ON public.devices(stage);
CREATE INDEX IF NOT EXISTS idx_devices_type ON public.devices(type);
CREATE INDEX IF NOT EXISTS idx_devices_mid ON public.devices(mid) WHERE mid IS NOT NULL AND mid != '';
CREATE INDEX IF NOT EXISTS idx_devices_tid ON public.devices(tid) WHERE tid IS NOT NULL AND tid != '';
CREATE INDEX IF NOT EXISTS idx_devices_custom_fields ON public.devices USING GIN(custom_fields);

-- 4. Historical Merchants Ledger (Archive & Termination Records)
CREATE TABLE IF NOT EXISTS public.historical_merchants (
  record_id VARCHAR(32) PRIMARY KEY,
  merchant_name VARCHAR(160) NOT NULL,
  merchant_phone VARCHAR(32),
  address TEXT,
  mid VARCHAR(32) NOT NULL,
  tid VARCHAR(32) NOT NULL,
  device_type VARCHAR(32) NOT NULL,
  model VARCHAR(64) NOT NULL,
  serial VARCHAR(64) NOT NULL,
  battery_serial VARCHAR(64),
  branch_id VARCHAR(16) REFERENCES public.branches(id) ON UPDATE CASCADE,
  branch_name VARCHAR(120),
  installed_date DATE,
  returned_date DATE NOT NULL DEFAULT CURRENT_DATE,
  active_duration_months INT DEFAULT 1,
  return_reason TEXT,
  status VARCHAR(24) DEFAULT 'TERMINATED',
  handled_by_staff VARCHAR(120),
  settlement_finalized BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hist_merchants_mid ON public.historical_merchants(mid);
CREATE INDEX IF NOT EXISTS idx_hist_merchants_serial ON public.historical_merchants(serial);

-- 5. Stock Requisitions Table
CREATE TABLE IF NOT EXISTS public.requisitions (
  req_id VARCHAR(32) PRIMARY KEY,
  date VARCHAR(32) NOT NULL DEFAULT CURRENT_DATE::text,
  branch_id VARCHAR(16) REFERENCES public.branches(id) ON UPDATE CASCADE,
  branch_name VARCHAR(120) NOT NULL,
  staff VARCHAR(120) NOT NULL,
  pos_qty INT NOT NULL DEFAULT 0,
  sb_qty INT NOT NULL DEFAULT 0,
  reason TEXT,
  status VARCHAR(32) NOT NULL DEFAULT 'PENDING_ADMIN',
  arranged_devices JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requisitions_branch ON public.requisitions(branch_id);
CREATE INDEX IF NOT EXISTS idx_requisitions_status ON public.requisitions(status);

-- 6. Audit Logs Table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id BIGSERIAL PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  detail TEXT NOT NULL,
  role VARCHAR(32),
  branch_id VARCHAR(16),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs(created_at DESC);

-- ==============================================================================
-- Row-Level Security (RLS) Configuration
-- ==============================================================================

ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historical_merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.requisitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- (21 Oct 2026) NO "allow everyone" policies. Access rules (sign-in, roles, branches) are in
-- migrations/20261021_01_security_and_field_review.sql – run it after this file. Never add USING (true) policies:
-- the website's public key would then let anyone read and change the stock.

-- ==============================================================================
-- Realtime CDC Publication Setup
-- ==============================================================================
-- Enable Realtime events for tables so UI updates automatically via WebSockets
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'devices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.devices;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'requisitions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.requisitions;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND tablename = 'historical_merchants'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.historical_merchants;
  END IF;
END $$;

-- ==============================================================================
-- Initial Seed Data: Core Branches
-- ==============================================================================
INSERT INTO public.branches (id, name, code, region, manager, staff)
VALUES 
  ('100', 'Head Office (In-Store MS Unit)', '100', 'Central HQ', 'SAY Chanmakara (8986)', '["SAY Chanmakara (8986)"]'::jsonb),
  ('101', 'Borei Keyla Branch', '101', '7 Makara, Phnom Penh', 'SEOUN Chettra (25490)', '["SEOUN Chettra (25490)"]'::jsonb),
  ('102', 'Olympic Branch', '102', 'Chamkarmon, Phnom Penh', 'KIM Sreypov (18293)', '["KIM Sreypov (18293)"]'::jsonb),
  ('105', 'Toul Kork Branch', '105', 'Toul Kork, Phnom Penh', 'NI Oudomroth (10811)', '["NI Oudomroth (10811)"]'::jsonb)
ON CONFLICT (id) DO NOTHING;

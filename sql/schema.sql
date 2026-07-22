-- ============================================================================
-- Flow Console — Supabase schema
-- Run this once in your Supabase project's SQL Editor (Project → SQL Editor
-- → New query → paste all of this → Run).
--
-- Three tables:
--   uploads            one row per file uploaded via the admin panel (a log)
--   movements_raw       row-level detail — mirrors the "records" the app's
--                        own parser already produces (one row per unique
--                        month + item + store + circle + MO/IR + serial no)
--   movements_summary   coarse rollups (month × item × store × circle × flow)
--                        used to make the dashboard's KPIs/charts fast without
--                        scanning movements_raw, which will grow large over time
-- ============================================================================

-- ---------- uploads (log of every admin upload) ----------
create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  report_type text not null check (report_type in ('inward','issuance','s2s')),
  file_name text not null,
  uploaded_by text,
  replace_mode boolean not null default false,
  months text[] default '{}',
  total_rows_source integer default 0,
  aggregated_row_count integer default 0,
  sheets_skipped text[] default '{}',
  created_at timestamptz not null default now()
);

-- ---------- movements_raw (row-level detail) ----------
create table if not exists movements_raw (
  id bigserial primary key,
  report_type text not null check (report_type in ('inward','issuance','s2s')),
  month_order integer not null,
  month_label text not null,
  item_code text not null,
  item_description text,
  store text not null,
  circle text,
  flow text,                      -- s2s only: which sheet/direction (e.g. "Other to SDFX")
  qty numeric not null default 0, -- inward/s2s: qty. issuance: allocate qty.
  recover_qty numeric default 0,  -- issuance only
  moir text,
  mo_status text,
  ordered_qty numeric,
  non_serial_qty numeric,
  is_serialised boolean,
  serial_no text,
  engineer_name text,             -- issuance only
  material_type text,             -- issuance only
  txn_type text,                  -- issuance only: Allocate / Recover / Mixed
  upload_id uuid references uploads(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_raw_lookup on movements_raw (report_type, month_label, item_code, store);
create index if not exists idx_raw_item on movements_raw (report_type, item_code);
create index if not exists idx_raw_store on movements_raw (report_type, store);
create index if not exists idx_raw_upload on movements_raw (upload_id);
-- Full text-ish search helper (ILIKE against these is fine at moderate scale;
-- add a trigram index later if search gets slow: requires pg_trgm extension).

-- ---------- movements_summary (fast rollups for KPIs/charts) ----------
create table if not exists movements_summary (
  id bigserial primary key,
  report_type text not null check (report_type in ('inward','issuance','s2s')),
  month_order integer not null,
  month_label text not null,
  item_code text not null,
  item_description text,
  store text not null,
  circle text not null default '',
  flow text not null default '',
  qty numeric not null default 0,          -- inward/s2s qty, or issuance allocate qty
  recover_qty numeric not null default 0,  -- issuance only
  record_count integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (report_type, month_order, item_code, store, circle, flow)
);

create index if not exists idx_summary_lookup on movements_summary (report_type, month_order);

-- ============================================================================
-- Row Level Security
-- No login is used for this tool (any team member with the link can insert
-- via the admin panel), so these policies are intentionally open to the
-- anon role. That means anyone holding your project's anon key (which is
-- embedded in the client-side code) can read AND write this data. That's a
-- deliberate tradeoff for convenience, not an oversight — tighten later by
-- restricting these policies (e.g. to an authenticated role) if needed.
-- ============================================================================
alter table uploads enable row level security;
alter table movements_raw enable row level security;
alter table movements_summary enable row level security;

create policy "anon full access" on uploads for all to anon using (true) with check (true);
create policy "anon full access" on movements_raw for all to anon using (true) with check (true);
create policy "anon full access" on movements_summary for all to anon using (true) with check (true);

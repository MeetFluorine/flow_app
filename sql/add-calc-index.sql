-- Run this once in Supabase → SQL Editor. Safe to run even if it already
-- exists (if not exists), and doesn't touch or lock existing data for long —
-- CONCURRENTLY avoids locking the table while it builds.
--
-- Why: the Calculation tab looks up one item+store combo across ALL report
-- types at once, with no report_type filter. Every index that already
-- exists on movements_raw is led by report_type, so Postgres couldn't use
-- any of them for that query and fell back to scanning the whole table —
-- which is what caused the "statement timeout" error once you had a few
-- months of data loaded.

create index concurrently if not exists idx_raw_item_store
  on movements_raw (item_code, store);

-- Run this in Supabase → SQL Editor to remove the Feb data that got saved
-- with month_label = 'Sheet1' before the parser fix.
--
-- Check first what's actually there (adjust report_type as needed —
-- run this three times, once per type you uploaded as "Sheet1"):
select report_type, month_label, count(*) as rows, sum(qty) as total_qty
from movements_raw
where month_label = 'Sheet1'
group by report_type, month_label;

-- Once you've confirmed that's the bad data, delete it (repeat for each
-- report_type you uploaded under the "Sheet1" label — inward / issuance / s2s):
delete from movements_raw where report_type = 'inward' and month_label = 'Sheet1';
delete from movements_summary where report_type = 'inward' and month_label = 'Sheet1';

delete from movements_raw where report_type = 'issuance' and month_label = 'Sheet1';
delete from movements_summary where report_type = 'issuance' and month_label = 'Sheet1';

delete from movements_raw where report_type = 's2s' and month_label = 'Sheet1';
delete from movements_summary where report_type = 's2s' and month_label = 'Sheet1';

-- Then re-upload the same three Feb files through the Admin panel (in
-- "Add to existing data" mode is fine now, since the bad rows are gone) —
-- the fixed parser will pick up the month from the date column this time.

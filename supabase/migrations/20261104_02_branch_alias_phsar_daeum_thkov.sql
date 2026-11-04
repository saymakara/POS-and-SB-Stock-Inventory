-- 04 Nov 2026 · Merchant Visit spells the branch "Phsar Daeum Thkov Branch"; the portal has "Phsar Derm Thkov Branch" (115).
-- Its POS / Sound Box and KHQR entries arrived without a branch (54 in the last 14 days). Same fix as the existing
-- "Samdech Monireth" alias: one mapping row, additive. Applied to production on 04 Nov 2026.
insert into public.branch_aliases (alias_norm, branch_id) values (app.norm('Phsar Daeum Thkov Branch'), '115')
on conflict do nothing;

-- Fictional demo data only: the class each of the seven demo requests is about, so the
-- dashboard shows realistic class codes. Real requests are never touched, because each
-- line matches one demo request by its id and its fictional_demo label.
update public.requests set course_id = 'english_standard', year_level = 11 where id = '00000000-0000-4000-8000-000000000203' and data_label = 'fictional_demo'; -- BK-1043, lesson change
update public.requests set course_id = 'maths_advanced', year_level = 12 where id = '00000000-0000-4000-8000-000000000202' and data_label = 'fictional_demo'; -- FAM-07, $75 refund
update public.requests set course_id = 'biology', year_level = 11 where id = '00000000-0000-4000-8000-000000000201' and data_label = 'fictional_demo'; -- BK-1042, $30 refund
update public.requests set course_id = 'business_studies', year_level = 12 where id = '00000000-0000-4000-8000-000000000304' and data_label = 'fictional_demo'; -- BK-1044, payment extension
update public.requests set course_id = 'modern_history', year_level = 11 where id = '00000000-0000-4000-8000-000000000303' and data_label = 'fictional_demo'; -- BK-1046, $58 refund
update public.requests set course_id = 'software_engineering', year_level = 12 where id = '00000000-0000-4000-8000-000000000302' and data_label = 'fictional_demo'; -- BK-1047, $60 refund
update public.requests set course_id = 'visual_arts', year_level = 11 where id = '00000000-0000-4000-8000-000000000301' and data_label = 'fictional_demo'; -- BK-1042, $55 refund

-- Kept off the Overview cards at the owner's request (still on the Requests page).
update public.requests set overview_hidden = true where id = '00000000-0000-4000-8000-000000000202' and data_label = 'fictional_demo'; -- FAM-07, $75 refund

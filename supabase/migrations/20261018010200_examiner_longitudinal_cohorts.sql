-- Examiner records matched QA cohorts without asserting improvement from inadequate samples.
CREATE OR REPLACE VIEW public.sandy_examiner_longitudinal_daily AS
SELECT e.case_key,
 (e.created_at AT TIME ZONE 'UTC')::date AS utc_day,
 count(*)::integer AS attempts,
 count(*) FILTER(WHERE e.verdict='pass')::integer AS passes,
 count(*) FILTER(WHERE e.verdict='fail')::integer AS failures,
 count(*) FILTER(WHERE e.verdict='needs_review')::integer AS reviews,
 round((100.0*count(*) FILTER(WHERE e.verdict='pass')/nullif(count(*),0))::numeric,2) AS observed_pass_percentage,
 round(avg(e.duration_ms)::numeric,0) AS mean_duration_ms
FROM public.sandy_v2_qa_executions e
JOIN public.sandy_v2_qa_account q ON q.customer_id=e.customer_id AND q.id=1
GROUP BY e.case_key,(e.created_at AT TIME ZONE 'UTC')::date;

CREATE OR REPLACE VIEW public.sandy_examiner_longitudinal_comparison AS
WITH cohorts AS (
 SELECT e.case_key,
 count(*) FILTER(WHERE e.created_at>=now()-interval '7 days') AS recent_n,
 count(*) FILTER(WHERE e.created_at<now()-interval '7 days' AND e.created_at>=now()-interval '14 days') AS previous_n,
 count(*) FILTER(WHERE e.created_at>=now()-interval '7 days' AND e.verdict='pass') AS recent_pass,
 count(*) FILTER(WHERE e.created_at<now()-interval '7 days' AND e.created_at>=now()-interval '14 days' AND e.verdict='pass') AS previous_pass
 FROM public.sandy_v2_qa_executions e
 JOIN public.sandy_v2_qa_account q ON q.customer_id=e.customer_id AND q.id=1
 WHERE e.created_at>=now()-interval '14 days'
 GROUP BY e.case_key
)
SELECT case_key,recent_n,previous_n,
 CASE WHEN recent_n>=4 AND previous_n>=4 THEN round((recent_pass::numeric/recent_n)*100,2) END AS recent_pass_percentage,
 CASE WHEN recent_n>=4 AND previous_n>=4 THEN round((previous_pass::numeric/previous_n)*100,2) END AS previous_pass_percentage,
 CASE WHEN recent_n>=4 AND previous_n>=4 THEN round(100*(recent_pass::numeric/recent_n-previous_pass::numeric/previous_n),2) END AS delta_percentage_points,
 CASE WHEN recent_n>=4 AND previous_n>=4 THEN 'comparable' ELSE 'insufficient_matched_samples' END AS evidence_status
FROM cohorts;
REVOKE ALL ON public.sandy_examiner_longitudinal_daily,public.sandy_examiner_longitudinal_comparison FROM public,anon,authenticated;
GRANT SELECT ON public.sandy_examiner_longitudinal_daily,public.sandy_examiner_longitudinal_comparison TO service_role;

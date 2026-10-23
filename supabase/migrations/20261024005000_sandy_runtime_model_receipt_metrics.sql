BEGIN;
-- Extend the existing one-row-per-paid-round ledger; do not create another
-- billing/outcome store, backfill guessed usage, or change any caller grants.
DO $source_guard$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.sandy_runtime_conversation_receipt_guard()'::regprocedure) INTO definition;
 IF md5(definition)<>'d67fca3362ed7a1e216014a8bc71f6ea' THEN RAISE EXCEPTION 'runtime_receipt_guard_source_changed'; END IF;
END $source_guard$;
ALTER TABLE public.sandy_runtime_conversation_audit ADD COLUMN model_metrics jsonb;
ALTER TABLE public.sandy_runtime_conversation_audit ADD CONSTRAINT sandy_runtime_model_metrics_shape CHECK (
 model_metrics IS NULL OR (
  jsonb_typeof(model_metrics)='object'
  AND model_metrics->>'schema_version'='1'
  AND model_metrics->>'source'='received_provider_envelope'
  AND model_metrics->'provider_effect_verified'='false'::jsonb
  AND model_metrics ?& ARRAY['model_returned','request_duration_ms','usage','estimated_cost_usd','cost_basis','rate_verified_at']
  AND model_metrics - ARRAY['schema_version','source','model_returned','request_duration_ms','usage','estimated_cost_usd','cost_basis','rate_verified_at','provider_effect_verified']='{}'::jsonb
  AND jsonb_typeof(model_metrics->'model_returned') IN ('string','null')
  AND jsonb_typeof(model_metrics->'request_duration_ms') IN ('number','null')
  AND jsonb_typeof(model_metrics->'usage') IN ('object','null')
  AND jsonb_typeof(model_metrics->'estimated_cost_usd') IN ('number','null')
  AND model_metrics->>'cost_basis' IN ('unavailable_usage_or_model','unavailable_exact_fresh_rate','estimated_exact_model_verified_rate')
  AND jsonb_typeof(model_metrics->'rate_verified_at') IN ('string','null')
 ) IS TRUE
);
COMMENT ON COLUMN public.sandy_runtime_conversation_audit.model_metrics IS
 'Bounded received model-envelope usage and gateway-inclusive duration. Rate-based cost is an estimate, never actual billing or functional outcome verification. Historical unknowns remain NULL.';
DO $preserve_guard$
DECLARE definition text;
BEGIN
 SELECT pg_get_functiondef('public.sandy_runtime_conversation_receipt_guard()'::regprocedure) INTO definition;
 IF md5(definition)<>'d67fca3362ed7a1e216014a8bc71f6ea' THEN RAISE EXCEPTION 'runtime_receipt_guard_source_changed'; END IF;
 definition:=replace(definition,
  'ARRAY[''state'',''provider_response_id'',''response_sha256'',''error'',''finished_at'']',
  'ARRAY[''state'',''provider_response_id'',''response_sha256'',''error'',''finished_at'',''model_metrics'']');
 definition:=replace(definition,
  'IF NEW.state<>''started'' OR NEW.provider_response_id IS NOT NULL OR NEW.response_sha256 IS NOT NULL THEN',
  'IF NEW.state<>''started'' OR NEW.provider_response_id IS NOT NULL OR NEW.response_sha256 IS NOT NULL OR NEW.model_metrics IS NOT NULL THEN');
 EXECUTE definition;
END $preserve_guard$;
COMMIT;

-- Refine the existing operation, preserving its no-argument legacy request.
-- This publishes a contract, not provider execution certification.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry WHERE operation='engineering.preflight'
 AND handler='sandy-engineering-control' AND input_schema='{"type":"object"}'::jsonb AND NOT is_mutation)
 THEN RAISE EXCEPTION 'expected_preflight_contract_required'; END IF;
END $$;
UPDATE public.sandy_operation_registry SET input_schema='{"type":"object","properties":{"connection":{"type":"string","enum":["sandy-gcp-admin"]}},"additionalProperties":false}'::jsonb,
 updated_at=clock_timestamp() WHERE operation='engineering.preflight';
COMMIT;

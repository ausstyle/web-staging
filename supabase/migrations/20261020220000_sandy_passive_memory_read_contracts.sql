-- Passive Memory Portal contracts only; caller authorization stays in both handlers.
-- Reviewed deployed sandy-memory-centre index.ts SHA-256: 8cd8879a3a22c9fad4d5ebb37a783fb26544f5d8bc83b6842338ca23df468ace
-- Ask can create tasks; search/biography/life_search incur model calls and are excluded.
BEGIN;
DO $contracts$
DECLARE
  contract record;
  existing public.sandy_operation_registry%ROWTYPE;
BEGIN
  -- This fixed SQL function is the only RPC used by the five reviewed reads.
  IF to_regprocedure('public.sandy_life_brief(uuid)') IS NULL OR
    md5(pg_get_functiondef('public.sandy_life_brief(uuid)'::regprocedure))
      <> '440a4af95e3d7acec9401f4488c6d470' THEN
    RAISE EXCEPTION 'sandy_life_brief source drifted; review passive memory contracts';
  END IF;
  FOR contract IN
    SELECT * FROM (VALUES
      ('memory.overview','Read the authenticated Memory Portal customer snapshot; no model calls or mutations; contract v1.0.0.','{"type":"object","properties":{},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","overview"],"properties":{"ok":{"const":true},"overview":{"type":"object","required":["name","settings","profile","total","facts","matters","execution","agent","checklist","insights","notes","rejected_facts"],"properties":{"name":{"type":"string"},"settings":{"type":["object","null"]},"profile":{"type":["object","null"]},"total":{"type":"integer","minimum":0},"facts":{"type":"array","maxItems":80,"items":{"type":"object"}},"matters":{"type":"array","maxItems":20,"items":{"type":"object"}},"execution":{"type":"array","maxItems":50,"items":{"type":"object"}},"agent":{"type":"array","maxItems":25,"items":{"type":"object"}},"checklist":{"type":"array","maxItems":120,"items":{"type":"object"}},"insights":{"type":"array","maxItems":20,"items":{"type":"object"}},"notes":{"type":"array","maxItems":30,"items":{"type":"object"}},"rejected_facts":{"type":"array","maxItems":150,"items":{"type":"object"}}},"additionalProperties":false}},"additionalProperties":false}'::jsonb),
      ('memory.tree','Read the authenticated Memory Portal customer subject tree and fact links; contract v1.0.0.','{"type":"object","properties":{},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","subjects","links"],"properties":{"ok":{"const":true},"subjects":{"type":"array","items":{"type":"object"}},"links":{"type":"array","items":{"type":"object"}}},"additionalProperties":false}'::jsonb),
      ('memory.evidence','Read one active archive source owned by the authenticated Memory Portal customer; contract v1.0.0.','{"type":"object","required":["id"],"properties":{"id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","item"],"properties":{"ok":{"const":true},"item":{"type":"object","required":["id","content"],"properties":{"id":{"type":"string","format":"uuid"},"content":{"type":"string","maxLength":12000}}}},"additionalProperties":false}'::jsonb),
      ('memory.life_brief','Read the consent-aware life summary for the authenticated Memory Portal customer; contract v1.0.0.','{"type":"object","properties":{},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","brief"],"properties":{"ok":{"const":true},"brief":{"type":"object","required":["enabled"],"properties":{"enabled":{"type":"boolean"}}}},"additionalProperties":false}'::jsonb),
      ('memory.life_spaces','Read life spaces, area catalogue and document suggestions for the authenticated Memory Portal customer; contract v1.0.0.','{"type":"object","properties":{},"additionalProperties":false}'::jsonb,'{"type":"object","required":["ok","spaces","areas","suggestions"],"properties":{"ok":{"const":true},"spaces":{"type":"array","items":{"type":"object"}},"areas":{"type":"array","items":{"type":"object"}},"suggestions":{"type":"array","items":{"type":"object"}}},"additionalProperties":false}'::jsonb)
    ) AS contracts(operation, description, input_schema, output_schema)
  LOOP
    SELECT * INTO existing FROM public.sandy_operation_registry
      WHERE operation = contract.operation FOR UPDATE;
    IF NOT FOUND OR existing.handler IS DISTINCT FROM 'sandy-memory-centre'
      OR existing.permission_scope IS DISTINCT FROM 'memory:read'
      OR existing.is_mutation IS DISTINCT FROM false
      OR existing.verified IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'Memory read registry identity drifted for %', contract.operation;
    END IF;
    IF existing.input_schema = '{"type":"object"}'::jsonb
      AND existing.output_schema = '{"type":"object"}'::jsonb
      AND existing.description IS NULL THEN
      UPDATE public.sandy_operation_registry SET
        description = contract.description,
        input_schema = contract.input_schema,
        output_schema = contract.output_schema,
        updated_at = now()
      WHERE operation = contract.operation;
    ELSIF existing.input_schema = contract.input_schema
      AND existing.output_schema = contract.output_schema
      AND existing.description = contract.description THEN
      NULL; -- The same reviewed contract may be reapplied without changing evidence.
    ELSE
      RAISE EXCEPTION 'Memory read schemas drifted for %', contract.operation;
    END IF;
  END LOOP;
END;
$contracts$;
COMMIT;

-- Version existing read contracts without changing customer data or legacy executors.
-- API validates these schemas and forwards the user's JWT. Backend tenant filters remain mandatory.
BEGIN;
WITH contracts AS (
  SELECT operation,
    CASE
      WHEN operation IN ('tasks.get','calendar.get','files.get') THEN
        '{"type":"object","required":["id"],"properties":{"id":{"type":"string","format":"uuid"}},"additionalProperties":false}'::jsonb
      WHEN operation = 'calendar.conflicts' THEN
        '{"type":"object","required":["starts_at","ends_at"],"properties":{"starts_at":{"type":"string","format":"date-time"},"ends_at":{"type":"string","format":"date-time"},"from":{"type":"string","format":"date-time"},"to":{"type":"string","format":"date-time"}},"additionalProperties":false}'::jsonb
      WHEN operation = 'calendar.list' THEN
        '{"type":"object","properties":{"from":{"type":"string","format":"date-time"},"to":{"type":"string","format":"date-time"}},"additionalProperties":false}'::jsonb
      WHEN operation = 'files.search' THEN
        '{"type":"object","required":["query"],"properties":{"query":{"type":"string","minLength":1,"maxLength":100}},"additionalProperties":false}'::jsonb
      ELSE '{"type":"object","properties":{},"additionalProperties":false}'::jsonb
    END AS input_schema,
    CASE
      WHEN operation IN ('tasks.get','calendar.get','files.get') THEN
        '{"type":"object","required":["ok","item"],"properties":{"ok":{"const":true},"item":{"type":"object"}},"additionalProperties":false}'::jsonb
      WHEN operation = 'calendar.conflicts' THEN
        '{"type":"object","required":["ok","conflicts"],"properties":{"ok":{"const":true},"conflicts":{"type":"array","items":{"type":"object"}}},"additionalProperties":false}'::jsonb
      ELSE '{"type":"object","required":["ok","items"],"properties":{"ok":{"const":true},"items":{"type":"array","maxItems":100,"items":{"type":"object"}}},"additionalProperties":false}'::jsonb
    END AS output_schema
  FROM (VALUES ('tasks.list'),('tasks.get'),('calendar.list'),('calendar.get'),
    ('calendar.conflicts'),('files.list'),('files.get'),('files.search')) AS operations(operation)
)
UPDATE public.sandy_operation_registry AS registry SET
  input_schema = contracts.input_schema,
  output_schema = contracts.output_schema,
  updated_at = now()
FROM contracts
WHERE registry.operation = contracts.operation
  AND registry.handler = 'sandy-operations-api' AND registry.is_mutation = false
  AND registry.input_schema = '{}'::jsonb AND registry.output_schema = '{}'::jsonb;
COMMIT;

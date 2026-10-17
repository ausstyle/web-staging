# sandy_task_api_receipts — deployed column metadata

Read-only snapshot, NOT a migration. No customer data.

- id: uuid; nullable=NO; default=gen_random_uuid()
- customer_id: uuid; nullable=NO; default=none
- source_channel: text; nullable=NO; default=none
- source_id: text; nullable=NO; default=none
- request_key: text; nullable=NO; default=none
- action: text; nullable=NO; default=none
- payload_sha256: text; nullable=NO; default=none
- status: text; nullable=NO; default='processing'::text
- result: jsonb; nullable=YES; default=none
- error: text; nullable=YES; default=none
- created_at: timestamp with time zone; nullable=NO; default=now()
- finished_at: timestamp with time zone; nullable=YES; default=none

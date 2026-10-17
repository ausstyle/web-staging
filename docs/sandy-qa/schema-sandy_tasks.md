# sandy_tasks — deployed column metadata

Read-only snapshot, NOT a migration. No customer data.

- id: uuid; nullable=NO; default=gen_random_uuid()
- customer_id: uuid; nullable=NO; default=none
- parent_task_id: uuid; nullable=YES; default=none
- title: text; nullable=NO; default=none
- details: text; nullable=NO; default=''::text
- status: text; nullable=NO; default='todo'::text
- priority: text; nullable=NO; default='normal'::text
- due_at: timestamp with time zone; nullable=YES; default=none
- next_review_at: timestamp with time zone; nullable=YES; default=none
- waiting_on: text; nullable=YES; default=none
- source_kind: text; nullable=NO; default='manual'::text
- source_key: text; nullable=YES; default=none
- position: integer; nullable=NO; default=0
- updated_by: text; nullable=NO; default='system'::text
- created_at: timestamp with time zone; nullable=NO; default=now()
- updated_at: timestamp with time zone; nullable=NO; default=now()
- completed_at: timestamp with time zone; nullable=YES; default=none
- version: integer; nullable=NO; default=1
- metadata: jsonb; nullable=NO; default='{}'::jsonb
- archived_at: timestamp with time zone; nullable=YES; default=none
- start_at: timestamp with time zone; nullable=YES; default=none
- contact_name: text; nullable=YES; default=none
- company_id: uuid; nullable=YES; default=none
- responsible_customer_id: uuid; nullable=YES; default=none

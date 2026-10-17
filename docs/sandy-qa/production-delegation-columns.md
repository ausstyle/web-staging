# Production task-delegation columns

Read-only verified reference, not a migration.

- id: uuid; nullable=NO; default=gen_random_uuid()
- owner_customer_id: uuid; nullable=NO; default=none
- task_id: uuid; nullable=NO; default=none
- assignee_customer_id: uuid; nullable=NO; default=none
- status: text; nullable=NO; default='invited'::text
- scope: text; nullable=NO; default='task'::text
- created_at: timestamp with time zone; nullable=NO; default=now()
- updated_at: timestamp with time zone; nullable=NO; default=now()
- accepted_at: timestamp with time zone; nullable=YES; default=none

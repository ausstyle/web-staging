# sandy_task_participants — deployed column metadata

Read-only snapshot, NOT a migration. No customer data.

- task_id: uuid; nullable=NO; default=none
- customer_id: uuid; nullable=NO; default=none
- role: text; nullable=NO; default=none
- scope: text; nullable=NO; default='subtree'::text
- status: text; nullable=NO; default='invited'::text
- created_at: timestamp with time zone; nullable=NO; default=now()
- updated_at: timestamp with time zone; nullable=NO; default=now()

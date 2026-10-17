# Verified production constraints: sandy_task_participants

Catalog snapshot, not migration SQL.

- `sandy_task_participants_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES email_customers(id) ON DELETE CASCADE`
- `sandy_task_participants_pkey`: `PRIMARY KEY (task_id, customer_id)`
- `sandy_task_participants_role_check`: `CHECK ((role = ANY (ARRAY['collaborator'::text, 'viewer'::text])))`
- `sandy_task_participants_scope_check`: `CHECK ((scope = ANY (ARRAY['task'::text, 'subtree'::text])))`
- `sandy_task_participants_status_check`: `CHECK ((status = ANY (ARRAY['invited'::text, 'accepted'::text, 'declined'::text, 'revoked'::text])))`
- `sandy_task_participants_task_id_fkey`: `FOREIGN KEY (task_id) REFERENCES sandy_tasks(id) ON DELETE CASCADE`

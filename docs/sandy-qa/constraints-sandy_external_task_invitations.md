# Verified production constraints: sandy_external_task_invitations

Catalog snapshot, not migration SQL.

- `sandy_external_task_invitations_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES email_customers(id)`
- `sandy_external_task_invitations_pkey`: `PRIMARY KEY (id)`
- `sandy_external_task_invitations_reply_message_id_fkey`: `FOREIGN KEY (reply_message_id) REFERENCES email_messages(id)`
- `sandy_external_task_invitations_reply_message_id_key`: `UNIQUE (reply_message_id)`
- `sandy_external_task_invitations_scope_check`: `CHECK ((scope = ANY (ARRAY['task'::text, 'subtree'::text])))`
- `sandy_external_task_invitations_status_check`: `CHECK ((status = ANY (ARRAY['sending'::text, 'sent'::text, 'accepted'::text, 'email_accepted'::text, 'failed'::text, 'cancelled'::text])))`
- `sandy_external_task_invitations_task_id_email_key`: `UNIQUE (task_id, email)`
- `sandy_external_task_invitations_task_id_owner_customer_id_fkey`: `FOREIGN KEY (task_id, owner_customer_id) REFERENCES sandy_tasks(id, customer_id) ON DELETE CASCADE`
- `sandy_external_task_invitations_token_hash_key`: `UNIQUE (token_hash)`

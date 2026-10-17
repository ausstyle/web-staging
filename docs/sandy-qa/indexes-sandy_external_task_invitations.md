# Production indexes: sandy_external_task_invitations

Verified catalog metadata; not a migration.

- `sandy_external_task_invitations_pkey`: `CREATE UNIQUE INDEX sandy_external_task_invitations_pkey ON public.sandy_external_task_invitations USING btree (id)`
- `sandy_external_task_invitations_reply_message_id_key`: `CREATE UNIQUE INDEX sandy_external_task_invitations_reply_message_id_key ON public.sandy_external_task_invitations USING btree (reply_message_id)`
- `sandy_external_task_invitations_task_id_email_key`: `CREATE UNIQUE INDEX sandy_external_task_invitations_task_id_email_key ON public.sandy_external_task_invitations USING btree (task_id, email)`
- `sandy_external_task_invitations_token_hash_key`: `CREATE UNIQUE INDEX sandy_external_task_invitations_token_hash_key ON public.sandy_external_task_invitations USING btree (token_hash)`

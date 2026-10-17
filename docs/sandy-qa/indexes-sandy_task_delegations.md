# Production indexes: sandy_task_delegations

Verified catalog metadata; not a migration.

- `sandy_delegations_assignee`: `CREATE INDEX sandy_delegations_assignee ON public.sandy_task_delegations USING btree (assignee_customer_id, status)`
- `sandy_delegations_owner`: `CREATE INDEX sandy_delegations_owner ON public.sandy_task_delegations USING btree (owner_customer_id, task_id)`
- `sandy_task_delegations_pkey`: `CREATE UNIQUE INDEX sandy_task_delegations_pkey ON public.sandy_task_delegations USING btree (id)`
- `sandy_task_delegations_task_id_assignee_customer_id_key`: `CREATE UNIQUE INDEX sandy_task_delegations_task_id_assignee_customer_id_key ON public.sandy_task_delegations USING btree (task_id, assignee_customer_id)`

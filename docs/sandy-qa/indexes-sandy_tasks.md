# Production indexes: sandy_tasks

Verified catalog metadata; not a migration.

- `sandy_tasks_company`: `CREATE INDEX sandy_tasks_company ON public.sandy_tasks USING btree (customer_id, company_id, status)`
- `sandy_tasks_due`: `CREATE INDEX sandy_tasks_due ON public.sandy_tasks USING btree (customer_id, due_at) WHERE (status <> ALL (ARRAY['completed'::text, 'cancelled'::text]))`
- `sandy_tasks_id_customer_id_key`: `CREATE UNIQUE INDEX sandy_tasks_id_customer_id_key ON public.sandy_tasks USING btree (id, customer_id)`
- `sandy_tasks_parent`: `CREATE INDEX sandy_tasks_parent ON public.sandy_tasks USING btree (customer_id, parent_task_id, "position")`
- `sandy_tasks_pkey`: `CREATE UNIQUE INDEX sandy_tasks_pkey ON public.sandy_tasks USING btree (id)`
- `sandy_tasks_review`: `CREATE INDEX sandy_tasks_review ON public.sandy_tasks USING btree (next_review_at) WHERE (status <> ALL (ARRAY['completed'::text, 'cancelled'::text]))`
- `sandy_tasks_source_identity`: `CREATE UNIQUE INDEX sandy_tasks_source_identity ON public.sandy_tasks USING btree (customer_id, source_kind, source_key) WHERE (source_key IS NOT NULL)`
- `sandy_tasks_user_status`: `CREATE INDEX sandy_tasks_user_status ON public.sandy_tasks USING btree (customer_id, status, updated_at DESC)`
- `sandy_tasks_voice_request_unique`: `CREATE UNIQUE INDEX sandy_tasks_voice_request_unique ON public.sandy_tasks USING btree (customer_id, source_key) WHERE ((source_kind = 'voice'::text) AND (source_key ~~ 'shared_task_request:%'::text))`

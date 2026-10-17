# Production indexes: sandy_task_api_receipts

Verified catalog metadata; not a migration.

- `sandy_task_api_receipts_customer_id_source_channel_source_i_key`: `CREATE UNIQUE INDEX sandy_task_api_receipts_customer_id_source_channel_source_i_key ON public.sandy_task_api_receipts USING btree (customer_id, source_channel, source_id, request_key)`
- `sandy_task_api_receipts_pkey`: `CREATE UNIQUE INDEX sandy_task_api_receipts_pkey ON public.sandy_task_api_receipts USING btree (id)`
- `sandy_task_api_receipts_recent`: `CREATE INDEX sandy_task_api_receipts_recent ON public.sandy_task_api_receipts USING btree (customer_id, created_at DESC)`

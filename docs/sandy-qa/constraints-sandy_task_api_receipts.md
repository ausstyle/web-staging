# Verified production constraints: sandy_task_api_receipts

Catalog snapshot, not migration SQL.

- `sandy_task_api_receipts_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES email_customers(id) ON DELETE CASCADE`
- `sandy_task_api_receipts_customer_id_source_channel_source_i_key`: `UNIQUE (customer_id, source_channel, source_id, request_key)`
- `sandy_task_api_receipts_pkey`: `PRIMARY KEY (id)`
- `sandy_task_api_receipts_request_key_check`: `CHECK (((length(request_key) >= 1) AND (length(request_key) <= 80)))`
- `sandy_task_api_receipts_source_channel_check`: `CHECK ((source_channel = ANY (ARRAY['email'::text, 'whatsapp'::text, 'voice'::text])))`
- `sandy_task_api_receipts_source_id_check`: `CHECK (((length(source_id) >= 1) AND (length(source_id) <= 200)))`
- `sandy_task_api_receipts_status_check`: `CHECK ((status = ANY (ARRAY['processing'::text, 'succeeded'::text, 'failed'::text])))`

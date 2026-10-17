# Verified production constraints: sandy_tasks

Catalog snapshot, not migration SQL.

- `sandy_agenda_task_company_check`: `TRIGGER DEFERRABLE INITIALLY DEFERRED`
- `sandy_tasks_company_tenant_fk`: `FOREIGN KEY (company_id, customer_id) REFERENCES sandy_agenda_companies(id, customer_id)`
- `sandy_tasks_customer_id_fkey`: `FOREIGN KEY (customer_id) REFERENCES email_customers(id) ON DELETE CASCADE`
- `sandy_tasks_id_customer_id_key`: `UNIQUE (id, customer_id)`
- `sandy_tasks_no_self_parent`: `CHECK (((parent_task_id IS NULL) OR (parent_task_id <> id)))`
- `sandy_tasks_parent_tenant_fk`: `FOREIGN KEY (parent_task_id, customer_id) REFERENCES sandy_tasks(id, customer_id) ON DELETE RESTRICT`
- `sandy_tasks_pkey`: `PRIMARY KEY (id)`
- `sandy_tasks_priority_check`: `CHECK ((priority = ANY (ARRAY['low'::text, 'normal'::text, 'high'::text, 'urgent'::text])))`
- `sandy_tasks_responsible_customer_id_fkey`: `FOREIGN KEY (responsible_customer_id) REFERENCES email_customers(id)`
- `sandy_tasks_status_check`: `CHECK ((status = ANY (ARRAY['todo'::text, 'in_progress'::text, 'waiting'::text, 'blocked'::text, 'completed'::text, 'cancelled'::text])))`
- `sandy_tasks_title_check`: `CHECK (((char_length(btrim(title)) >= 1) AND (char_length(btrim(title)) <= 240)))`

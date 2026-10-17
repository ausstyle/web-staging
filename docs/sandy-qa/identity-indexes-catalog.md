# Production identity-indexes reference

Read-only metadata, not executable migration SQL. No customer rows.

- `{"tablename":"email_customer_addresses","indexname":"email_customer_addresses_pkey","indexdef":"CREATE UNIQUE INDEX email_customer_addresses_pkey ON public.email_customer_addresses USING btree (id)"}`
- `{"tablename":"email_customer_addresses","indexname":"normalized_email_unique","indexdef":"CREATE UNIQUE INDEX normalized_email_unique ON public.email_customer_addresses USING btree (normalized_email)"}`
- `{"tablename":"email_customer_addresses","indexname":"email_one_primary_per_customer","indexdef":"CREATE UNIQUE INDEX email_one_primary_per_customer ON public.email_customer_addresses USING btree (customer_id) WHERE is_primary"}`
- `{"tablename":"email_customers","indexname":"email_customers_pkey","indexdef":"CREATE UNIQUE INDEX email_customers_pkey ON public.email_customers USING btree (id)"}`
- `{"tablename":"email_customers","indexname":"email_customers_google_drive_folder_unique","indexdef":"CREATE UNIQUE INDEX email_customers_google_drive_folder_unique ON public.email_customers USING btree (google_drive_folder_id) WHERE (google_drive_folder_id IS NOT NULL)"}`
- `{"tablename":"email_customers","indexname":"email_customers_drive_pending_idx","indexdef":"CREATE INDEX email_customers_drive_pending_idx ON public.email_customers USING btree (google_drive_folder_status, id) WHERE (google_drive_folder_status = ANY (ARRAY['pending'::text, 'error'::text]))"}`
- `{"tablename":"sandy_agenda_access","indexname":"sandy_agenda_access_pkey","indexdef":"CREATE UNIQUE INDEX sandy_agenda_access_pkey ON public.sandy_agenda_access USING btree (email)"}`
- `{"tablename":"sandy_agenda_access","indexname":"sandy_agenda_access_customer","indexdef":"CREATE INDEX sandy_agenda_access_customer ON public.sandy_agenda_access USING btree (customer_id)"}`
- `{"tablename":"sandy_memory_portal_accounts","indexname":"sandy_memory_portal_accounts_pkey","indexdef":"CREATE UNIQUE INDEX sandy_memory_portal_accounts_pkey ON public.sandy_memory_portal_accounts USING btree (auth_user_id)"}`
- `{"tablename":"sandy_memory_portal_accounts","indexname":"sandy_memory_portal_accounts_customer_id_key","indexdef":"CREATE UNIQUE INDEX sandy_memory_portal_accounts_customer_id_key ON public.sandy_memory_portal_accounts USING btree (customer_id)"}`
- `{"tablename":"sandy_whatsapp_identities","indexname":"sandy_whatsapp_identities_pkey","indexdef":"CREATE UNIQUE INDEX sandy_whatsapp_identities_pkey ON public.sandy_whatsapp_identities USING btree (wa_id)"}`
- `{"tablename":"sandy_whatsapp_identities","indexname":"sandy_whatsapp_verified_customer_idx","indexdef":"CREATE INDEX sandy_whatsapp_verified_customer_idx ON public.sandy_whatsapp_identities USING btree (customer_id) WHERE (verification_status = 'verified'::text)"}`
- `{"tablename":"sandy_whatsapp_identities","indexname":"sandy_whatsapp_one_primary_per_customer","indexdef":"CREATE UNIQUE INDEX sandy_whatsapp_one_primary_per_customer ON public.sandy_whatsapp_identities USING btree (customer_id) WHERE (is_primary AND (verification_status = 'verified'::text) AND (customer_id IS NOT NULL))"}`

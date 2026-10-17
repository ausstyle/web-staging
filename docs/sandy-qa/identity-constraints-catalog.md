# Production identity-constraints reference

Read-only catalog metadata, not migration SQL. Exported from live project 2026-10-17. No customer rows.

- `{"table_name":"email_customer_addresses","conname":"email_address_valid","definition":"CHECK (((email_address = btrim(email_address)) AND ((length(email_address) >= 3) AND (length(email_address) <= 320)) AND (email_address ~~ '%_@_%._%'::text) AND (POSITION((' '::text) IN (email_address)) = 0)))"}`
- `{"table_name":"email_customer_addresses","conname":"email_customer_addresses_customer_id_fkey","definition":"FOREIGN KEY (customer_id) REFERENCES email_customers(id) ON DELETE CASCADE"}`
- `{"table_name":"email_customer_addresses","conname":"email_customer_addresses_pkey","definition":"PRIMARY KEY (id)"}`
- `{"table_name":"email_customer_addresses","conname":"normalized_email_unique","definition":"UNIQUE (normalized_email)"}`
- `{"table_name":"email_customers","conname":"email_customers_google_drive_folder_status_check","definition":"CHECK ((google_drive_folder_status = ANY (ARRAY['pending'::text, 'linked'::text, 'excluded'::text, 'error'::text])))"}`
- `{"table_name":"email_customers","conname":"email_customers_pkey","definition":"PRIMARY KEY (id)"}`
- `{"table_name":"sandy_agenda_access","conname":"sandy_agenda_access_customer_id_fkey","definition":"FOREIGN KEY (customer_id) REFERENCES email_customers(id) ON DELETE CASCADE"}`
- `{"table_name":"sandy_agenda_access","conname":"sandy_agenda_access_pkey","definition":"PRIMARY KEY (email)"}`
- `{"table_name":"sandy_memory_portal_accounts","conname":"sandy_memory_portal_accounts_auth_user_id_fkey","definition":"FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE"}`
- `{"table_name":"sandy_memory_portal_accounts","conname":"sandy_memory_portal_accounts_customer_id_fkey","definition":"FOREIGN KEY (customer_id) REFERENCES email_customers(id) ON DELETE CASCADE"}`
- `{"table_name":"sandy_memory_portal_accounts","conname":"sandy_memory_portal_accounts_customer_id_key","definition":"UNIQUE (customer_id)"}`
- `{"table_name":"sandy_memory_portal_accounts","conname":"sandy_memory_portal_accounts_pkey","definition":"PRIMARY KEY (auth_user_id)"}`
- `{"table_name":"sandy_whatsapp_identities","conname":"sandy_whatsapp_identities_check","definition":"CHECK (((verification_status <> 'verified'::text) OR ((customer_id IS NOT NULL) AND (verified_at IS NOT NULL))))"}`
- `{"table_name":"sandy_whatsapp_identities","conname":"sandy_whatsapp_identities_customer_id_fkey","definition":"FOREIGN KEY (customer_id) REFERENCES email_customers(id) ON DELETE SET NULL"}`
- `{"table_name":"sandy_whatsapp_identities","conname":"sandy_whatsapp_identities_pkey","definition":"PRIMARY KEY (wa_id)"}`
- `{"table_name":"sandy_whatsapp_identities","conname":"sandy_whatsapp_identities_verification_status_check","definition":"CHECK ((verification_status = ANY (ARRAY['unverified'::text, 'verified'::text, 'revoked'::text])))"}`

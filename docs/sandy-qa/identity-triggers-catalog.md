# Production identity-triggers reference

Read-only metadata, not executable migration SQL. No customer rows.

- `{"tablename":"email_customers","tgname":"sandy_member_memory_on_customer_create","definition":"CREATE TRIGGER sandy_member_memory_on_customer_create AFTER INSERT ON public.email_customers FOR EACH ROW EXECUTE FUNCTION sandy_initialise_member_memory()"}`
- `{"tablename":"email_customers","tgname":"sandy_queue_new_customer_drive","definition":"CREATE TRIGGER sandy_queue_new_customer_drive AFTER INSERT OR UPDATE OF google_drive_folder_status ON public.email_customers FOR EACH ROW EXECUTE FUNCTION sandy_queue_new_customer_drive()"}`
- `{"tablename":"sandy_whatsapp_identities","tgname":"sandy_verified_identity_account_match","definition":"CREATE TRIGGER sandy_verified_identity_account_match AFTER INSERT OR DELETE OR UPDATE ON public.sandy_whatsapp_identities FOR EACH ROW EXECUTE FUNCTION sandy_refresh_match_identity_trigger()"}`
- `{"tablename":"sandy_whatsapp_identities","tgname":"sandy_whatsapp_auto_primary","definition":"CREATE TRIGGER sandy_whatsapp_auto_primary AFTER INSERT OR DELETE OR UPDATE OF customer_id, verification_status ON public.sandy_whatsapp_identities FOR EACH ROW EXECUTE FUNCTION sandy_whatsapp_elect_primary()"}`

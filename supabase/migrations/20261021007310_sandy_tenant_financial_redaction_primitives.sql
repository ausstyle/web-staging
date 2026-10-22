-- Private exact same-transaction redaction leases; ordinary financial guards stay closed.
BEGIN;
CREATE FUNCTION public.sandy_tenant_financial_redaction_new(p_resource text,p_row jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp AS $$
DECLARE marker jsonb:=to_jsonb('[redacted:subject-data-request]'::text);items jsonb;
BEGIN
 IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' OR p_row->>'id' IS NULL THEN RAISE EXCEPTION 'financial_redaction_row_invalid';END IF;
 IF p_resource='sandy_commerce_accounts' THEN RETURN jsonb_set(p_row,'{name}',marker);
 ELSIF p_resource IN('sandy_commerce_entries','sandy_commerce_entry_lines','sandy_commerce_statement_lines') THEN RETURN jsonb_set(p_row,'{description}',marker);
 ELSIF p_resource='sandy_commerce_entitlements' THEN RETURN jsonb_set(p_row,'{reason}',marker);
 ELSIF p_resource='sandy_commerce_invoices' THEN
  IF jsonb_typeof(p_row->'items') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'financial_redaction_invoice_items_invalid';END IF;
  SELECT jsonb_agg(jsonb_set(value,'{description}',marker) ORDER BY ordinal) INTO items FROM jsonb_array_elements(p_row->'items') WITH ORDINALITY e(value,ordinal);
  RETURN jsonb_set(jsonb_set(p_row,'{counterparty_name}',marker),'{items}',items);
 ELSE RAISE EXCEPTION 'financial_redaction_resource_not_supported';END IF;
END $$;
CREATE FUNCTION public.sandy_tenant_financial_invoice_coordinate() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
DECLARE tenants uuid[]:='{}';tenant uuid;source_tenant uuid;
BEGIN
 IF TG_TABLE_NAME='sandy_api_execution_admissions' THEN
  IF NEW.operation='commerce.invoice_forward.request' AND NEW.tenant_id IS NOT NULL THEN tenants:=array_append(tenants,NEW.tenant_id);END IF;
  IF TG_OP='UPDATE' AND OLD.operation='commerce.invoice_forward.request' AND OLD.tenant_id IS NOT NULL THEN tenants:=array_append(tenants,OLD.tenant_id);END IF;
 ELSIF TG_TABLE_NAME='sandy_email_action_receipts' THEN
  IF NEW.action_type='invoice_forward' THEN SELECT customer_id INTO source_tenant FROM public.email_messages WHERE id=NEW.source_message_id FOR SHARE;tenants:=array_append(tenants,source_tenant);END IF;
  IF TG_OP='UPDATE' AND OLD.action_type='invoice_forward' THEN SELECT customer_id INTO source_tenant FROM public.email_messages WHERE id=OLD.source_message_id FOR SHARE;tenants:=array_append(tenants,source_tenant);END IF;
 ELSIF TG_TABLE_NAME='email_messages' THEN
  IF OLD.customer_id IS DISTINCT FROM NEW.customer_id AND EXISTS(SELECT 1 FROM public.sandy_email_action_receipts WHERE source_message_id=OLD.id AND action_type='invoice_forward') THEN tenants:=ARRAY[OLD.customer_id,NEW.customer_id];END IF;
 ELSE RAISE EXCEPTION 'financial_redaction_invoice_coordination_target_invalid';END IF;
 FOR tenant IN SELECT DISTINCT v FROM unnest(tenants)v WHERE v IS NOT NULL ORDER BY v LOOP PERFORM pg_advisory_xact_lock(hashtextextended('sandy_financial_invoice_boundary_v1:'||tenant::text,0));END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER sandy_tenant_financial_invoice_admission_boundary BEFORE INSERT OR UPDATE OF state,tenant_id,operation ON public.sandy_api_execution_admissions FOR EACH ROW EXECUTE FUNCTION public.sandy_tenant_financial_invoice_coordinate();
CREATE TRIGGER sandy_tenant_financial_invoice_receipt_boundary BEFORE INSERT OR UPDATE ON public.sandy_email_action_receipts FOR EACH ROW EXECUTE FUNCTION public.sandy_tenant_financial_invoice_coordinate();
CREATE TRIGGER sandy_tenant_financial_invoice_source_boundary BEFORE UPDATE OF customer_id ON public.email_messages FOR EACH ROW EXECUTE FUNCTION public.sandy_tenant_financial_invoice_coordinate();
CREATE INDEX sandy_tenant_financial_invoice_admission_scan ON public.sandy_api_execution_admissions(tenant_id,state) WHERE operation='commerce.invoice_forward.request';
CREATE INDEX sandy_tenant_financial_invoice_receipt_scan ON public.sandy_email_action_receipts(source_message_id,status) WHERE action_type='invoice_forward';
CREATE FUNCTION public.sandy_tenant_financial_invoice_pending(p_tenant uuid,p_lock boolean) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp AS $$
BEGIN
 IF p_tenant IS NULL OR p_lock IS NULL THEN RAISE EXCEPTION 'financial_redaction_invoice_boundary_invalid';END IF;
 IF p_lock THEN
  IF current_setting('transaction_isolation') IS DISTINCT FROM 'read committed' THEN RAISE EXCEPTION 'financial_redaction_current_invoice_snapshot_required';END IF;
  IF NOT pg_try_advisory_xact_lock(hashtextextended('sandy_financial_invoice_boundary_v1:'||p_tenant::text,0)) THEN RAISE EXCEPTION 'financial_redaction_invoice_boundary_busy';END IF;
 END IF;
 -- Stored receipts describe attempts, not an attestation that the asserted invoice/source/PDF correspond.
 IF EXISTS(SELECT 1 FROM public.sandy_email_action_receipts r JOIN public.email_messages m ON m.id=r.source_message_id WHERE m.customer_id=p_tenant AND r.action_type='invoice_forward' AND r.status NOT IN('verified','failed')) THEN RAISE EXCEPTION 'financial_redaction_pending_delivery_refused';END IF;
 -- A consumed/unknown dispatch can precede receipt claim. A settled historical accepted attempt is not forever pending.
 IF EXISTS(SELECT 1 FROM public.sandy_api_execution_admissions a LEFT JOIN public.sandy_product_provider_dispatches d ON d.admission_id=a.id LEFT JOIN public.sandy_product_results result ON result.admission_id=a.id WHERE a.tenant_id=p_tenant AND a.operation='commerce.invoice_forward.request' AND(a.state IN('consumed','unknown') OR a.state='admitted' AND a.expires_at>clock_timestamp() OR a.state='accepted' AND NOT(
   result.executed IS TRUE AND(coalesce(result.result->'item'->>'status'='verified',false) OR EXISTS(SELECT 1 FROM public.sandy_email_action_receipts settled WHERE settled.action_type='invoice_forward' AND settled.source_message_id::text=d.context->>'source_message_id' AND settled.status IN('verified','failed') AND settled.created_at>=d.created_at))
  ))) THEN RAISE EXCEPTION 'financial_redaction_pending_delivery_refused';END IF;
END $$;
REVOKE ALL ON FUNCTION public.sandy_tenant_financial_invoice_coordinate(),public.sandy_tenant_financial_invoice_pending(uuid,boolean) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.sandy_tenant_financial_redaction_plan(p_tenant uuid,p_resource text,p_ids uuid[],p_cutoff timestamptz,p_lock boolean DEFAULT false) RETURNS SETOF jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $$
DECLARE manifest jsonb:=public.sandy_tenant_financial_redaction_manifest_v1();entry jsonb;col jsonb;projection text;size_sql text;predicate text;cutoff_sql text;query text;row_data record;before_data jsonb;after_data jsonb;row_count integer:=0;oversize boolean;parent public.sandy_commerce_entries;account public.sandy_commerce_accounts;statement public.sandy_commerce_statements;totals jsonb;
BEGIN
 IF p_tenant IS NULL OR p_ids IS NULL OR cardinality(p_ids) NOT BETWEEN 1 AND 1000 OR array_ndims(p_ids)<>1 OR array_position(p_ids,NULL) IS NOT NULL OR cardinality(p_ids)<>(SELECT count(DISTINCT id) FROM unnest(p_ids)id) OR p_cutoff IS NULL OR NOT isfinite(p_cutoff) OR p_cutoff>clock_timestamp() OR p_lock IS NULL THEN RAISE EXCEPTION 'financial_redaction_scope_invalid';END IF;
 IF current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN RAISE EXCEPTION 'financial_redaction_trigger_execution_required';END IF;
 IF public.sandy_tenant_financial_redaction_schema_sha256() IS DISTINCT FROM manifest->>'schema_sha256' THEN RAISE EXCEPTION 'financial_redaction_schema_changed';END IF;
  IF encode(extensions.digest((SELECT prosrc FROM pg_proc WHERE oid='public.sandy_commerce_guard_posted_entry()'::regprocedure),'sha256'),'hex') IS DISTINCT FROM 'b7acec1c033060d631343848b4d1395e86f0b3d14f2f265e1ec6cf6652ff89c0' THEN RAISE EXCEPTION 'financial_redaction_guard_source_changed';END IF;
 IF encode(extensions.digest((SELECT prosrc FROM pg_proc WHERE oid='public.sandy_commerce_guard_posted_line()'::regprocedure),'sha256'),'hex') IS DISTINCT FROM '0b032c40d57a94387ec999e4559dd8b5a66d7a0e3fd46644c0e8774d5a171b57' THEN RAISE EXCEPTION 'financial_redaction_guard_source_changed';END IF;
 IF encode(extensions.digest((SELECT prosrc FROM pg_proc WHERE oid='public.sandy_commerce_guard_issued_invoice()'::regprocedure),'sha256'),'hex') IS DISTINCT FROM '5eb047517e818e6dda5f8f68e61db0b531eb87a8c6f9ae39ce94db8169c7f8d1' THEN RAISE EXCEPTION 'financial_redaction_guard_source_changed';END IF;
 SELECT value INTO entry FROM jsonb_array_elements(manifest->'resources') WHERE value->>'table'=p_resource;
 IF entry IS NULL THEN RAISE EXCEPTION 'financial_redaction_resource_not_supported';END IF;
 IF p_resource='sandy_commerce_invoices' THEN
   IF encode(extensions.digest((SELECT prosrc FROM pg_proc WHERE oid='public.sandy_tenant_financial_invoice_coordinate()'::regprocedure),'sha256'),'hex') IS DISTINCT FROM 'ddd0e8a6f12dfa5db595c5b757043a9acd6237cbb700bcea2490d5c93cf777df' THEN RAISE EXCEPTION 'financial_redaction_invoice_guard_source_changed';END IF;
   IF encode(extensions.digest((SELECT prosrc FROM pg_proc WHERE oid='public.sandy_tenant_financial_invoice_pending(uuid,boolean)'::regprocedure),'sha256'),'hex') IS DISTINCT FROM '5754f3df433ebb769414ff9d78a6a614c4ef32469ec7461d47a567bc226125fb' THEN RAISE EXCEPTION 'financial_redaction_invoice_guard_source_changed';END IF;
   IF (SELECT jsonb_agg(jsonb_build_object('table',c.relname,'trigger',g.tgname,'definition',pg_get_triggerdef(g.oid),'enabled',g.tgenabled) ORDER BY c.relname,g.tgname) FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid WHERE g.tgname IN('sandy_tenant_financial_invoice_admission_boundary','sandy_tenant_financial_invoice_receipt_boundary','sandy_tenant_financial_invoice_source_boundary')) IS DISTINCT FROM $coordination$[{"table":"email_messages","enabled":"O","trigger":"sandy_tenant_financial_invoice_source_boundary","definition":"CREATE TRIGGER sandy_tenant_financial_invoice_source_boundary BEFORE UPDATE OF customer_id ON public.email_messages FOR EACH ROW EXECUTE FUNCTION public.sandy_tenant_financial_invoice_coordinate()"},{"table":"sandy_api_execution_admissions","enabled":"O","trigger":"sandy_tenant_financial_invoice_admission_boundary","definition":"CREATE TRIGGER sandy_tenant_financial_invoice_admission_boundary BEFORE INSERT OR UPDATE OF state, tenant_id, operation ON public.sandy_api_execution_admissions FOR EACH ROW EXECUTE FUNCTION public.sandy_tenant_financial_invoice_coordinate()"},{"table":"sandy_email_action_receipts","enabled":"O","trigger":"sandy_tenant_financial_invoice_receipt_boundary","definition":"CREATE TRIGGER sandy_tenant_financial_invoice_receipt_boundary BEFORE INSERT OR UPDATE ON public.sandy_email_action_receipts FOR EACH ROW EXECUTE FUNCTION public.sandy_tenant_financial_invoice_coordinate()"}]$coordination$::jsonb THEN RAISE EXCEPTION 'financial_redaction_invoice_guard_state_changed';END IF;
   PERFORM public.sandy_tenant_financial_invoice_pending(p_tenant,p_lock);
 END IF;
 predicate:='t.customer_id=$1';cutoff_sql:='t.created_at<=$3';
 IF p_resource='sandy_commerce_entry_lines' THEN predicate:='EXISTS(SELECT 1 FROM public.sandy_commerce_entries e WHERE e.id=t.entry_id AND e.customer_id=$1 AND e.created_at<=$3)';cutoff_sql:='true';
 ELSIF p_resource='sandy_commerce_statement_lines' THEN predicate:='EXISTS(SELECT 1 FROM public.sandy_commerce_statements s WHERE s.id=t.statement_id AND s.customer_id=$1 AND s.created_at<=$3)';cutoff_sql:='true';
 ELSIF p_resource='sandy_commerce_entitlements' THEN cutoff_sql:='t.updated_at<=$3';END IF;
 projection:='';size_sql:='';
 FOR col IN SELECT value FROM jsonb_array_elements(entry->'columns') LOOP
  projection:=projection||CASE WHEN projection='' THEN '' ELSE ',' END||format('%L,t.%I',col->>'name',col->>'name');
  size_sql:=size_sql||CASE WHEN size_sql='' THEN '' ELSE '+' END||format('coalesce(octet_length(t.%I::text),0)',col->>'name');
 END LOOP;
 EXECUTE format('SELECT EXISTS(SELECT 1 FROM public.%I t WHERE t.id=ANY($2) AND(%s) AND(%s) AND(%s)>12000000)',p_resource,predicate,cutoff_sql,size_sql) INTO oversize USING p_tenant,p_ids,p_cutoff;
 IF oversize THEN RAISE EXCEPTION 'financial_redaction_row_bound_exceeded';END IF;
 query:=format('SELECT jsonb_build_object(%s) AS item FROM public.%I t WHERE t.id=ANY($2) AND(%s) AND(%s) ORDER BY t.id%s',projection,p_resource,predicate,cutoff_sql,CASE WHEN p_lock THEN ' FOR UPDATE OF t'||CASE WHEN p_resource='sandy_commerce_invoices' THEN ' NOWAIT' ELSE '' END ELSE '' END);
 FOR row_data IN EXECUTE query USING p_tenant,p_ids,p_cutoff LOOP
  before_data:=row_data.item;
  IF octet_length(before_data::text)>16777216 THEN RAISE EXCEPTION 'financial_redaction_row_bound_exceeded';END IF;
  IF p_resource='sandy_commerce_entries' THEN
   IF before_data->>'reversal_of' IS NOT NULL THEN PERFORM 1 FROM public.sandy_commerce_entries e WHERE e.id=(before_data->>'reversal_of')::uuid AND e.customer_id=p_tenant FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'financial_redaction_parent_ownership_refused';END IF;END IF;
   IF before_data->>'state'='posted' AND((SELECT count(*) FROM public.sandy_commerce_entry_lines l WHERE l.entry_id=(before_data->>'id')::uuid)<2 OR(SELECT coalesce(sum(l.debit_minor::numeric-l.credit_minor::numeric),0) FROM public.sandy_commerce_entry_lines l WHERE l.entry_id=(before_data->>'id')::uuid)<>0) THEN RAISE EXCEPTION 'financial_redaction_posted_balance_required';END IF;
  ELSIF p_resource='sandy_commerce_entry_lines' THEN
   SELECT * INTO parent FROM public.sandy_commerce_entries e WHERE e.id=(before_data->>'entry_id')::uuid AND e.customer_id=p_tenant FOR SHARE;
   SELECT * INTO account FROM public.sandy_commerce_accounts a WHERE a.id=(before_data->>'account_id')::uuid AND a.customer_id=p_tenant FOR SHARE;
   IF parent.id IS NULL OR account.id IS NULL OR parent.currency IS DISTINCT FROM account.currency OR parent.minor_unit_exponent IS DISTINCT FROM account.minor_unit_exponent THEN RAISE EXCEPTION 'financial_redaction_parent_ownership_refused';END IF;
   IF parent.state='posted' AND((SELECT count(*) FROM public.sandy_commerce_entry_lines l WHERE l.entry_id=parent.id)<2 OR(SELECT coalesce(sum(l.debit_minor::numeric-l.credit_minor::numeric),0) FROM public.sandy_commerce_entry_lines l WHERE l.entry_id=parent.id)<>0) THEN RAISE EXCEPTION 'financial_redaction_posted_balance_required';END IF;
  ELSIF p_resource='sandy_commerce_statement_lines' THEN
   SELECT * INTO statement FROM public.sandy_commerce_statements s WHERE s.id=(before_data->>'statement_id')::uuid AND s.customer_id=p_tenant FOR SHARE;
   SELECT * INTO account FROM public.sandy_commerce_accounts a WHERE a.id=statement.account_id AND a.customer_id=p_tenant FOR SHARE;
   IF statement.id IS NULL OR account.id IS NULL THEN RAISE EXCEPTION 'financial_redaction_parent_ownership_refused';END IF;
  ELSIF p_resource='sandy_commerce_invoices' THEN
   IF before_data->>'forwarding_status' IN('claimed','sending','submitted','unknown','needs_review') THEN RAISE EXCEPTION 'financial_redaction_pending_delivery_refused';END IF;
   IF before_data->>'source_message_id' IS NOT NULL THEN PERFORM 1 FROM public.email_messages message WHERE message.id=(before_data->>'source_message_id')::uuid AND message.customer_id=p_tenant FOR SHARE NOWAIT;IF NOT FOUND THEN RAISE EXCEPTION 'financial_redaction_parent_ownership_refused';END IF;END IF;

   IF NOT public.sandy_tenant_financial_json_valid('sandy_commerce_invoices',before_data->'items',p_tenant,NULL) THEN RAISE EXCEPTION 'financial_redaction_invoice_items_invalid';END IF;
   totals:=public.sandy_commerce_invoice_totals(before_data->'items',before_data->>'tax_minor',before_data->>'discount_minor');
   IF totals->>'subtotal_minor' IS DISTINCT FROM before_data->>'subtotal_minor' OR totals->>'total_minor' IS DISTINCT FROM before_data->>'total_minor' THEN RAISE EXCEPTION 'financial_redaction_invoice_amounts_invalid';END IF;
  END IF;
  FOR col IN SELECT value FROM jsonb_array_elements(entry->'columns') LOOP
   IF col->>'type' IN('bigint','numeric(30,0)') AND before_data->>(col->>'name') !~ '^-?(0|[1-9][0-9]*)$' THEN RAISE EXCEPTION 'financial_redaction_nonfinite_amount_refused';END IF;
   IF col->>'type'='timestamp with time zone' AND before_data->>(col->>'name') IN('infinity','-infinity') THEN RAISE EXCEPTION 'financial_redaction_nonfinite_time_refused';END IF;
  END LOOP;
  after_data:=public.sandy_tenant_financial_redaction_new(p_resource,before_data);row_count:=row_count+1;
  RETURN NEXT jsonb_build_object('record_id',before_data->>'id','before_sha256',encode(extensions.digest(before_data::text,'sha256'),'hex'),'after_sha256',encode(extensions.digest(after_data::text,'sha256'),'hex'),'has_changes',before_data IS DISTINCT FROM after_data);
 END LOOP;
 IF row_count<>cardinality(p_ids) THEN RAISE EXCEPTION 'financial_redaction_owned_record_set_required';END IF;
END $$;
CREATE FUNCTION public.sandy_tenant_financial_redaction_plan_sha(p_rows jsonb,p_resource text,p_tenant uuid,p_cutoff timestamptz,p_manifest_sha text,p_phase text DEFAULT 'before') RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $$
DECLARE digest text;item jsonb;
BEGIN
 IF p_phase NOT IN('before','after') OR jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'financial_redaction_hash_scope_invalid';END IF;
 digest:=encode(extensions.digest(p_manifest_sha||':'||p_tenant::text||':'||p_resource||':'||p_cutoff::text,'sha256'),'hex');
 FOR item IN SELECT value FROM jsonb_array_elements(p_rows) ORDER BY value->>'record_id' COLLATE "C" LOOP digest:=encode(extensions.digest(digest||':'||(item->>'record_id')||':'||(item->>(p_phase||'_sha256')),'sha256'),'hex');END LOOP;
 RETURN digest;
END $$;
CREATE FUNCTION public.sandy_tenant_financial_redaction_lease_permits(p_resource text,p_old jsonb,p_new jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,pg_temp SET timezone='UTC' AS $$
DECLARE lease public.sandy_tenant_financial_redaction_leases;policy public.sandy_tenant_financial_redaction_policies;ctx jsonb;admission public.sandy_api_execution_admissions;
BEGIN
 SELECT * INTO lease FROM public.sandy_tenant_financial_redaction_leases l WHERE l.transaction_id=pg_current_xact_id() AND l.resource=p_resource AND l.record_id=(p_old->>'id')::uuid AND l.used_at IS NULL FOR UPDATE;
 IF lease.record_id IS NULL OR p_new IS DISTINCT FROM public.sandy_tenant_financial_redaction_new(p_resource,p_old) OR lease.before_sha256 IS DISTINCT FROM encode(extensions.digest(p_old::text,'sha256'),'hex') OR lease.after_sha256 IS DISTINCT FROM encode(extensions.digest(p_new::text,'sha256'),'hex') THEN RETURN false;END IF;
 SELECT * INTO admission FROM public.sandy_api_execution_admissions WHERE id=lease.admission_id;
 IF admission.operation IS DISTINCT FROM 'supabase.tenant.financial.redaction.apply' OR admission.contract_sha256 IS DISTINCT FROM '373c52908a5c8b38095f95d0213c89ebec4289458a4b25ba95e67f93820fc0ad' THEN RETURN false;END IF;
 ctx:=public.sandy_tenant_lifecycle_context(lease.actor_id,lease.admission_id,lease.canonical_arguments);
 IF ctx->>'operation' IS DISTINCT FROM admission.operation OR ctx->>'tenant_id' IS DISTINCT FROM lease.tenant_id::text OR ctx->>'manifest' IS DISTINCT FROM 'financial_subject_text_redaction_v1' OR ctx->'arguments'->>'policy_id' IS DISTINCT FROM lease.policy_id::text THEN RETURN false;END IF;
 SELECT * INTO policy FROM public.sandy_tenant_financial_redaction_policies WHERE id=lease.policy_id FOR SHARE;
 IF policy.id IS NULL OR policy.tenant_id IS DISTINCT FROM lease.tenant_id OR policy.resource IS DISTINCT FROM p_resource OR NOT lease.record_id=ANY(policy.record_ids) OR policy.effective_at>clock_timestamp() OR policy.expires_at<=clock_timestamp() OR policy.consent_revision IS DISTINCT FROM(SELECT revision FROM public.sandy_supabase_tenant_consents WHERE tenant_id=lease.tenant_id) OR EXISTS(SELECT 1 FROM public.sandy_tenant_financial_redaction_revocations WHERE policy_id=policy.id) OR EXISTS(SELECT 1 FROM public.sandy_tenant_financial_redaction_applications WHERE policy_id=policy.id) THEN RETURN false;END IF;
 IF p_resource IN('sandy_commerce_accounts','sandy_commerce_entries','sandy_commerce_invoices','sandy_commerce_entitlements') THEN
  IF p_old->>'customer_id' IS DISTINCT FROM lease.tenant_id::text THEN RETURN false;END IF;
 ELSIF p_resource='sandy_commerce_entry_lines' THEN
  IF NOT EXISTS(SELECT 1 FROM public.sandy_commerce_entries e JOIN public.sandy_commerce_accounts a ON a.id=(p_old->>'account_id')::uuid AND a.customer_id=lease.tenant_id WHERE e.id=(p_old->>'entry_id')::uuid AND e.customer_id=lease.tenant_id) THEN RETURN false;END IF;
 ELSIF p_resource='sandy_commerce_statement_lines' THEN
  IF NOT EXISTS(SELECT 1 FROM public.sandy_commerce_statements s JOIN public.sandy_commerce_accounts a ON a.id=s.account_id AND a.customer_id=lease.tenant_id WHERE s.id=(p_old->>'statement_id')::uuid AND s.customer_id=lease.tenant_id) THEN RETURN false;END IF;
 ELSE RETURN false;
 END IF;
 UPDATE public.sandy_tenant_financial_redaction_leases SET used_at=clock_timestamp() WHERE transaction_id=lease.transaction_id AND resource=lease.resource AND record_id=lease.record_id AND used_at IS NULL;
 RETURN FOUND;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
DO $$BEGIN IF encode(extensions.digest((SELECT prosrc FROM pg_proc WHERE oid='public.sandy_commerce_guard_posted_entry()'::regprocedure),'sha256'),'hex') IS DISTINCT FROM '65d28a9aa39aea8ed4a1795bb4d7b4f71f4297c7b12e85ae1ac309e8b9359586' THEN RAISE EXCEPTION 'financial_redaction_prior_guard_changed';END IF;END $$;
CREATE OR REPLACE FUNCTION public.sandy_commerce_guard_posted_entry() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$BEGIN IF TG_OP='UPDATE' AND public.sandy_tenant_financial_redaction_lease_permits('sandy_commerce_entries',to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW;END IF;IF OLD.state='posted' THEN RAISE EXCEPTION 'posted_journal_is_immutable_use_reversal' USING ERRCODE='23514';END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END$$;
DO $$BEGIN IF encode(extensions.digest((SELECT prosrc FROM pg_proc WHERE oid='public.sandy_commerce_guard_posted_line()'::regprocedure),'sha256'),'hex') IS DISTINCT FROM '436a15f3023adf1b8e6ac31846863429554eca3f2170d4e13bcbb53e7ef1464a' THEN RAISE EXCEPTION 'financial_redaction_prior_guard_changed';END IF;END $$;
CREATE OR REPLACE FUNCTION public.sandy_commerce_guard_posted_line() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN IF TG_OP='UPDATE' AND public.sandy_tenant_financial_redaction_lease_permits('sandy_commerce_entry_lines',to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW;END IF;IF EXISTS(SELECT 1 FROM public.sandy_commerce_entries WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.entry_id ELSE NEW.entry_id END AND state='posted') OR(TG_OP='UPDATE' AND EXISTS(SELECT 1 FROM public.sandy_commerce_entries WHERE id=OLD.entry_id AND state='posted')) THEN RAISE EXCEPTION 'posted_journal_lines_are_immutable' USING ERRCODE='23514';END IF;IF TG_OP='DELETE' THEN RETURN OLD;END IF;RETURN NEW;END$$;
DO $$BEGIN IF encode(extensions.digest((SELECT prosrc FROM pg_proc WHERE oid='public.sandy_commerce_guard_issued_invoice()'::regprocedure),'sha256'),'hex') IS DISTINCT FROM '048af21af6d74811fbd5120b4439c897edf889318d877e98a0cb82e6f30cb4dd' THEN RAISE EXCEPTION 'financial_redaction_prior_guard_changed';END IF;END $$;
CREATE OR REPLACE FUNCTION public.sandy_commerce_guard_issued_invoice() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,pg_temp AS $$
BEGIN IF public.sandy_tenant_financial_redaction_lease_permits('sandy_commerce_invoices',to_jsonb(OLD),to_jsonb(NEW)) THEN RETURN NEW;END IF;IF OLD.state IN('issued_internal','void') AND(NEW.counterparty_name IS DISTINCT FROM OLD.counterparty_name OR NEW.external_reference IS DISTINCT FROM OLD.external_reference OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.minor_unit_exponent IS DISTINCT FROM OLD.minor_unit_exponent OR NEW.items IS DISTINCT FROM OLD.items OR NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor OR NEW.tax_minor IS DISTINCT FROM OLD.tax_minor OR NEW.discount_minor IS DISTINCT FROM OLD.discount_minor OR NEW.total_minor IS DISTINCT FROM OLD.total_minor OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.invoice_number IS DISTINCT FROM OLD.invoice_number OR NEW.state NOT IN('issued_internal','void')) THEN RAISE EXCEPTION 'issued_invoice_values_are_immutable' USING ERRCODE='23514';END IF;RETURN NEW;END$$;
REVOKE ALL ON FUNCTION public.sandy_tenant_financial_redaction_new(text,jsonb),public.sandy_tenant_financial_redaction_plan(uuid,text,uuid[],timestamptz,boolean),public.sandy_tenant_financial_redaction_plan_sha(jsonb,text,uuid,timestamptz,text,text),public.sandy_tenant_financial_redaction_lease_permits(text,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

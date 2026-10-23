CREATE OR REPLACE FUNCTION sandy_private.correct_customer_fact(p_customer uuid, p_fact uuid, p_new_value text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare original record; created uuid;
begin
 select id,category,fact_key,fact_value into original from public.email_ai_profile_facts
 where id=p_fact and customer_id=p_customer and status='active' for update;
 if not found then raise exception 'active fact not found for customer' using errcode='P0002';end if;
 if p_new_value is null then
   update public.email_ai_profile_facts set status='rejected',reviewed_at=now()
   where id=p_fact and customer_id=p_customer;
   return p_fact;
 end if;
 if length(btrim(p_new_value))<2 or length(p_new_value)>1000 then
   raise exception 'corrected value must be 2-1000 characters';
 end if;
 if original.fact_value=btrim(p_new_value) then return p_fact; end if;
 insert into public.email_ai_profile_facts(customer_id,category,fact_key,fact_value,confidence,status,supersedes_fact_id,last_observed_at,reviewed_at)
 values(p_customer,original.category,original.fact_key,btrim(p_new_value),'high','active',p_fact,now(),now())
 returning id into created;
 update public.email_ai_profile_facts set status='superseded',reviewed_at=now()
 where id=p_fact and customer_id=p_customer;
 return created;
end $function$

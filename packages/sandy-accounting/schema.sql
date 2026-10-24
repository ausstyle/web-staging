-- Isolated accounting data-plane candidate. NEVER apply to the Sandy control plane.
-- The fixture role is NOLOGIN; authenticated Sandy API must supply verified scope.
CREATE SCHEMA accounting;
REVOKE ALL ON SCHEMA accounting FROM PUBLIC;
CREATE ROLE accounting_fixture NOLOGIN;
GRANT USAGE ON SCHEMA accounting TO accounting_fixture;

CREATE TABLE accounting.books (
 tenant_id text NOT NULL, company_id text NOT NULL, name text NOT NULL,
 currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'), precision integer NOT NULL CHECK (precision BETWEEN 0 AND 6),
 locked_through date, revision bigint NOT NULL DEFAULT 0,
 PRIMARY KEY (tenant_id,company_id)
);
CREATE TABLE accounting.accounts (
 tenant_id text NOT NULL, company_id text NOT NULL, id text NOT NULL, name text NOT NULL,
 kind text NOT NULL CHECK (kind IN ('asset','liability','equity','revenue','expense')),
 control text CHECK (control IN ('bank','ar','ap','tax')), active boolean NOT NULL DEFAULT true,
 PRIMARY KEY (tenant_id,company_id,id), FOREIGN KEY (tenant_id,company_id) REFERENCES accounting.books
);
CREATE TABLE accounting.journals (
 tenant_id text NOT NULL, company_id text NOT NULL, id text NOT NULL, effective_date date NOT NULL,
 narration text NOT NULL, currency text NOT NULL CHECK(currency ~ '^[A-Z]{3}$'), precision integer NOT NULL CHECK(precision BETWEEN 0 AND 6),
 fx jsonb, evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='array' AND jsonb_array_length(evidence)>0),
 actor_id text NOT NULL, source text NOT NULL, state text NOT NULL DEFAULT 'DRAFT' CHECK(state IN ('DRAFT','POSTED')),
 reversal_of text, created_at timestamptz NOT NULL DEFAULT now(), cash_basis boolean NOT NULL DEFAULT false,
 PRIMARY KEY(tenant_id,company_id,id), FOREIGN KEY(tenant_id,company_id) REFERENCES accounting.books,
 FOREIGN KEY(tenant_id,company_id,reversal_of) REFERENCES accounting.journals,
 UNIQUE(tenant_id,company_id,reversal_of)
);
CREATE TABLE accounting.lines (
 tenant_id text NOT NULL, company_id text NOT NULL, journal_id text NOT NULL, ordinal integer NOT NULL,
 account_id text NOT NULL, amount numeric NOT NULL CHECK(amount=trunc(amount) AND abs(amount)<1e30 AND amount<>0),
 base_amount numeric NOT NULL CHECK(base_amount=trunc(base_amount) AND abs(base_amount)<1e30 AND amount*base_amount>=0),
 PRIMARY KEY(tenant_id,company_id,journal_id,ordinal),
 FOREIGN KEY(tenant_id,company_id,journal_id) REFERENCES accounting.journals,
 FOREIGN KEY(tenant_id,company_id,account_id) REFERENCES accounting.accounts
);
CREATE INDEX accounting_lines_account ON accounting.lines(tenant_id,company_id,account_id,journal_id);
CREATE INDEX accounting_journal_date ON accounting.journals(tenant_id,company_id,effective_date) WHERE state='POSTED';

CREATE FUNCTION accounting.guard_journal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE lock_date date; b accounting.books;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'journal_immutable'; END IF;
 IF TG_OP='UPDATE' AND (OLD.state='POSTED' OR (to_jsonb(OLD)-'state')<>(to_jsonb(NEW)-'state')) THEN RAISE EXCEPTION 'journal_immutable'; END IF;
 SELECT * INTO STRICT b FROM accounting.books WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id FOR UPDATE;
 IF NEW.effective_date<=b.locked_through THEN RAISE EXCEPTION 'period_locked'; END IF;
 IF NEW.state='POSTED' THEN
  IF NEW.source NOT IN ('manual','reversal') AND NEW.cash_basis THEN RAISE EXCEPTION 'cash_basis_source'; END IF;
  IF NEW.reversal_of IS NOT NULL AND EXISTS(SELECT 1 FROM accounting.journals o WHERE o.tenant_id=NEW.tenant_id AND o.company_id=NEW.company_id AND o.id=NEW.reversal_of AND o.cash_basis<>NEW.cash_basis) THEN RAISE EXCEPTION 'cash_basis_reversal'; END IF;
  IF (SELECT count(*) FROM accounting.lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=NEW.id)<2
   OR EXISTS(SELECT 1 FROM accounting.lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=NEW.id HAVING sum(amount)<>0 OR sum(base_amount)<>0) THEN RAISE EXCEPTION 'journal_unbalanced'; END IF;
  IF NEW.currency=b.currency AND (NEW.precision<>b.precision OR NEW.fx IS NOT NULL OR EXISTS(SELECT 1 FROM accounting.lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=NEW.id AND amount<>base_amount)) THEN RAISE EXCEPTION 'invalid_base_currency'; END IF;
  IF NEW.currency<>b.currency AND (NEW.fx IS NULL OR NOT NEW.fx ?& ARRAY['numerator','denominator','source','date']) THEN RAISE EXCEPTION 'fx_evidence_required'; END IF;
  IF NEW.currency<>b.currency THEN
   IF NOT (NEW.fx->>'numerator' ~ '^[1-9][0-9]{0,17}$') OR NOT (NEW.fx->>'denominator' ~ '^[1-9][0-9]{0,17}$') THEN RAISE EXCEPTION 'fx_ratio'; END IF;
   IF EXISTS(SELECT 1 FROM accounting.lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=NEW.id AND base_amount<>round(amount*(NEW.fx->>'numerator')::numeric*power(10::numeric,b.precision)/((NEW.fx->>'denominator')::numeric*power(10::numeric,NEW.precision)))) THEN RAISE EXCEPTION 'fx_conversion_mismatch'; END IF;
  END IF;
  IF NEW.reversal_of IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM accounting.journals o WHERE o.tenant_id=NEW.tenant_id AND o.company_id=NEW.company_id AND o.id=NEW.reversal_of AND o.state='POSTED' AND ((o.source='manual' AND NEW.source='reversal') OR (o.source='payment' AND NEW.source='payment_reversal') OR (o.source IN ('invoice','bill') AND NEW.source='document_void') OR (o.source='credit' AND NEW.source='credit_reversal')) AND o.currency=NEW.currency AND o.precision=NEW.precision AND o.fx IS NOT DISTINCT FROM NEW.fx AND o.effective_date<=NEW.effective_date) THEN RAISE EXCEPTION 'invalid_reversal'; END IF;
   IF EXISTS((SELECT ordinal,account_id,amount,base_amount FROM accounting.lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=NEW.id) EXCEPT (SELECT ordinal,account_id,-amount,-base_amount FROM accounting.lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=NEW.reversal_of))
    OR (SELECT count(*) FROM accounting.lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=NEW.id)<>(SELECT count(*) FROM accounting.lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=NEW.reversal_of) THEN RAISE EXCEPTION 'reversal_lines_differ'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER journal_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting.journals FOR EACH ROW EXECUTE FUNCTION accounting.guard_journal();
CREATE FUNCTION accounting.guard_line() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j accounting.journals; a accounting.accounts;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'line_immutable'; END IF;
 SELECT * INTO STRICT j FROM accounting.journals WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.journal_id FOR UPDATE;
 IF j.state<>'DRAFT' THEN RAISE EXCEPTION 'journal_immutable'; END IF;
 SELECT * INTO STRICT a FROM accounting.accounts WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.account_id;
 IF NOT a.active THEN RAISE EXCEPTION 'account_inactive'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER line_guard BEFORE INSERT OR UPDATE OR DELETE ON accounting.lines FOR EACH ROW EXECUTE FUNCTION accounting.guard_line();

CREATE TABLE accounting.documents (
 tenant_id text NOT NULL, company_id text NOT NULL, id text NOT NULL, kind text NOT NULL CHECK(kind IN ('invoice','bill')),
 contact text NOT NULL, number text NOT NULL, issued date NOT NULL, due date NOT NULL CHECK(due>=issued),
 currency text NOT NULL, lines jsonb NOT NULL, total numeric NOT NULL CHECK(total>0 AND total=trunc(total)),
 control_account text NOT NULL, evidence jsonb NOT NULL, journal_id text, void_journal_id text,
 version integer NOT NULL DEFAULT 1, PRIMARY KEY(tenant_id,company_id,id), UNIQUE(tenant_id,company_id,kind,contact,number),
 FOREIGN KEY(tenant_id,company_id,control_account) REFERENCES accounting.accounts,
 FOREIGN KEY(tenant_id,company_id,journal_id) REFERENCES accounting.journals,
 FOREIGN KEY(tenant_id,company_id,void_journal_id) REFERENCES accounting.journals
);
CREATE TABLE accounting.allocations (
 tenant_id text NOT NULL, company_id text NOT NULL, id text NOT NULL, document_id text NOT NULL,
 journal_id text NOT NULL, amount numeric NOT NULL CHECK(amount>0 AND amount=trunc(amount)), components jsonb NOT NULL,
 PRIMARY KEY(tenant_id,company_id,id), FOREIGN KEY(tenant_id,company_id,document_id) REFERENCES accounting.documents,
 FOREIGN KEY(tenant_id,company_id,journal_id) REFERENCES accounting.journals
);
CREATE TABLE accounting.document_versions (
 tenant_id text NOT NULL, company_id text NOT NULL, document_id text NOT NULL,
 version integer NOT NULL CHECK(version>0), actor_id text NOT NULL CHECK(length(actor_id)>0), recorded_at timestamptz NOT NULL DEFAULT now(), snapshot jsonb NOT NULL,
 PRIMARY KEY(tenant_id,company_id,document_id,version), FOREIGN KEY(tenant_id,company_id,document_id) REFERENCES accounting.documents
);
CREATE FUNCTION accounting.record_document_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO accounting.document_versions(tenant_id,company_id,document_id,version,actor_id,snapshot)
 VALUES(NEW.tenant_id,NEW.company_id,NEW.id,NEW.version,current_setting('accounting.actor',true),to_jsonb(NEW)||jsonb_build_object('total',NEW.total::text));
 RETURN NEW;
END $$;
CREATE TRIGGER document_version AFTER INSERT OR UPDATE ON accounting.documents FOR EACH ROW EXECUTE FUNCTION accounting.record_document_version();
CREATE TABLE accounting.statements (
 tenant_id text NOT NULL, company_id text NOT NULL, id text NOT NULL, bank_account text NOT NULL,
 source_key text NOT NULL, effective_date date NOT NULL, amount numeric NOT NULL CHECK(amount<>0 AND amount=trunc(amount)),
 reference text NOT NULL, evidence jsonb NOT NULL, PRIMARY KEY(tenant_id,company_id,id),
 UNIQUE(tenant_id,company_id,bank_account,source_key), FOREIGN KEY(tenant_id,company_id,bank_account) REFERENCES accounting.accounts
);
CREATE TABLE accounting.allocation_reversals (
 tenant_id text NOT NULL, company_id text NOT NULL, allocation_id text NOT NULL, journal_id text NOT NULL,
 PRIMARY KEY(tenant_id,company_id,allocation_id), UNIQUE(tenant_id,company_id,journal_id),
 FOREIGN KEY(tenant_id,company_id,allocation_id) REFERENCES accounting.allocations,
 FOREIGN KEY(tenant_id,company_id,journal_id) REFERENCES accounting.journals
);
CREATE TABLE accounting.statement_imports (
 tenant_id text NOT NULL, company_id text NOT NULL, id text NOT NULL, bank_account text NOT NULL,
 actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), source jsonb NOT NULL,
 preview_digest text NOT NULL, rows jsonb NOT NULL,
 PRIMARY KEY(tenant_id,company_id,id), FOREIGN KEY(tenant_id,company_id,bank_account) REFERENCES accounting.accounts
);
CREATE TABLE accounting.matches (
 tenant_id text NOT NULL, company_id text NOT NULL, id text NOT NULL, statement_id text NOT NULL,
 journal_id text NOT NULL, ordinal integer NOT NULL, amount numeric NOT NULL CHECK(amount<>0 AND amount=trunc(amount)),
 PRIMARY KEY(tenant_id,company_id,id), FOREIGN KEY(tenant_id,company_id,statement_id) REFERENCES accounting.statements,
 FOREIGN KEY(tenant_id,company_id,journal_id,ordinal) REFERENCES accounting.lines
);
CREATE TABLE accounting.credits (
 tenant_id text NOT NULL, company_id text NOT NULL, id text NOT NULL, document_id text NOT NULL,
 journal_id text NOT NULL, number text NOT NULL, amount numeric NOT NULL CHECK(amount>0 AND amount=trunc(amount)),
 components jsonb NOT NULL, reason text NOT NULL,
 PRIMARY KEY(tenant_id,company_id,id), UNIQUE(tenant_id,company_id,number), UNIQUE(tenant_id,company_id,journal_id),
 FOREIGN KEY(tenant_id,company_id,document_id) REFERENCES accounting.documents,
 FOREIGN KEY(tenant_id,company_id,journal_id) REFERENCES accounting.journals
);
CREATE TABLE accounting.credit_reversals (
 tenant_id text NOT NULL, company_id text NOT NULL, credit_id text NOT NULL, journal_id text NOT NULL,
 PRIMARY KEY(tenant_id,company_id,credit_id), UNIQUE(tenant_id,company_id,journal_id),
 FOREIGN KEY(tenant_id,company_id,credit_id) REFERENCES accounting.credits,
 FOREIGN KEY(tenant_id,company_id,journal_id) REFERENCES accounting.journals
);
CREATE FUNCTION accounting.latest_settlement_date(t text,c text,doc text) RETURNS date LANGUAGE sql AS $$
 SELECT max(j.effective_date) FROM accounting.journals j JOIN (
  SELECT p.journal_id,r.journal_id AS reversal FROM accounting.allocations p LEFT JOIN accounting.allocation_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.allocation_id=p.id WHERE p.tenant_id=t AND p.company_id=c AND p.document_id=doc
  UNION ALL
  SELECT p.journal_id,r.journal_id FROM accounting.credits p LEFT JOIN accounting.credit_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.credit_id=p.id WHERE p.tenant_id=t AND p.company_id=c AND p.document_id=doc
 ) p ON j.id=p.journal_id OR j.id=p.reversal WHERE j.tenant_id=t AND j.company_id=c;
$$;
CREATE TABLE accounting.match_reversals (
 tenant_id text NOT NULL, company_id text NOT NULL, match_id text NOT NULL, reason text NOT NULL,
 PRIMARY KEY(tenant_id,company_id,match_id), FOREIGN KEY(tenant_id,company_id,match_id) REFERENCES accounting.matches
);
CREATE TABLE accounting.commands (
 tenant_id text NOT NULL, company_id text NOT NULL, actor_id text NOT NULL, operation text NOT NULL,
 key text NOT NULL, input_digest text NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(tenant_id,company_id,actor_id,operation,key)
);
CREATE TABLE accounting.events (
 tenant_id text NOT NULL, company_id text NOT NULL, sequence bigint NOT NULL, actor_id text NOT NULL,
 operation text NOT NULL, input_digest text NOT NULL, result_digest text NOT NULL, previous_digest text NOT NULL,
 digest text NOT NULL, policy_ref text NOT NULL, happened_at timestamptz NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(tenant_id,company_id,sequence)
);
CREATE FUNCTION accounting.guard_document() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.journal_id IS NULL AND NEW.journal_id IS NULL AND OLD.void_journal_id IS NULL AND NEW.void_journal_id IS NULL THEN
  IF ROW(OLD.tenant_id,OLD.company_id,OLD.id,OLD.kind) IS DISTINCT FROM ROW(NEW.tenant_id,NEW.company_id,NEW.id,NEW.kind) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'document_identity_immutable'; END IF;
  RETURN NEW;
 END IF;
 IF (to_jsonb(OLD)-ARRAY['version','journal_id','void_journal_id'])<>(to_jsonb(NEW)-ARRAY['version','journal_id','void_journal_id']) OR NEW.version<>OLD.version+1 OR (OLD.journal_id IS NOT NULL AND NEW.journal_id IS DISTINCT FROM OLD.journal_id) OR (OLD.void_journal_id IS NOT NULL AND NEW.void_journal_id IS DISTINCT FROM OLD.void_journal_id) THEN RAISE EXCEPTION 'document_immutable'; END IF;
 IF NEW.journal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounting.journals WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.journal_id AND state='POSTED' AND source=NEW.kind) THEN RAISE EXCEPTION 'invalid_document_posting'; END IF;
 IF NEW.void_journal_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM accounting.journals WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.void_journal_id AND state='POSTED' AND source='document_void' AND reversal_of=NEW.journal_id) THEN RAISE EXCEPTION 'invalid_document_void'; END IF;
 IF NEW.void_journal_id IS NOT NULL AND OLD.void_journal_id IS NULL THEN
  IF EXISTS(SELECT 1 FROM accounting.allocations p LEFT JOIN accounting.allocation_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.allocation_id=p.id WHERE p.tenant_id=NEW.tenant_id AND p.company_id=NEW.company_id AND p.document_id=NEW.id AND r.allocation_id IS NULL) OR EXISTS(SELECT 1 FROM accounting.credits p LEFT JOIN accounting.credit_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.credit_id=p.id WHERE p.tenant_id=NEW.tenant_id AND p.company_id=NEW.company_id AND p.document_id=NEW.id AND r.credit_id IS NULL) THEN RAISE EXCEPTION 'reverse_settlements_first'; END IF;
  IF EXISTS(SELECT 1 FROM accounting.journals j WHERE j.tenant_id=NEW.tenant_id AND j.company_id=NEW.company_id AND j.id=NEW.void_journal_id AND j.effective_date<accounting.latest_settlement_date(NEW.tenant_id,NEW.company_id,NEW.id)) THEN RAISE EXCEPTION 'void_before_payment_history'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER document_guard BEFORE UPDATE ON accounting.documents FOR EACH ROW EXECUTE FUNCTION accounting.guard_document();
CREATE FUNCTION accounting.guard_match() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s accounting.statements; l accounting.lines; j accounting.journals; b accounting.books; used_s numeric; used_l numeric;
BEGIN
 SELECT * INTO STRICT b FROM accounting.books WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id FOR UPDATE;
 SELECT * INTO STRICT s FROM accounting.statements WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.statement_id;
 SELECT * INTO STRICT l FROM accounting.lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=NEW.journal_id AND ordinal=NEW.ordinal;
 SELECT * INTO STRICT j FROM accounting.journals WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.journal_id;
 IF j.state<>'POSTED' OR j.currency<>b.currency OR l.account_id<>s.bank_account OR NEW.amount*s.amount<=0 OR NEW.amount*l.amount<=0 THEN RAISE EXCEPTION 'match_target'; END IF;
 IF s.effective_date<=b.locked_through OR j.effective_date<=b.locked_through THEN RAISE EXCEPTION 'period_locked'; END IF;
 SELECT coalesce(sum(m.amount) FILTER(WHERE m.statement_id=NEW.statement_id),0),coalesce(sum(m.amount) FILTER(WHERE m.journal_id=NEW.journal_id AND m.ordinal=NEW.ordinal),0) INTO used_s,used_l FROM accounting.matches m LEFT JOIN accounting.match_reversals r ON r.tenant_id=m.tenant_id AND r.company_id=m.company_id AND r.match_id=m.id WHERE m.tenant_id=NEW.tenant_id AND m.company_id=NEW.company_id AND r.match_id IS NULL;
 IF abs(used_s+NEW.amount)>abs(s.amount) OR abs(used_l+NEW.amount)>abs(l.amount) THEN RAISE EXCEPTION 'overmatched'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER match_guard BEFORE INSERT ON accounting.matches FOR EACH ROW EXECUTE FUNCTION accounting.guard_match();
CREATE FUNCTION accounting.assert_components(t text, c text, doc text, amount numeric, components jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE j text;
BEGIN
 SELECT journal_id INTO STRICT j FROM accounting.documents WHERE tenant_id=t AND company_id=c AND id=doc;
 IF jsonb_typeof(components)<>'array' OR jsonb_array_length(components)=0 THEN RAISE EXCEPTION 'invalid_components'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(components) x WHERE jsonb_typeof(x)<>'object' OR NOT x ?& ARRAY['ordinal','account_id','amount'] OR (SELECT count(*) FROM jsonb_object_keys(x))<>3 OR NOT (x->>'amount' ~ '^[1-9][0-9]{0,29}$') OR NOT (x->>'ordinal' ~ '^[0-9]{1,4}$')) THEN RAISE EXCEPTION 'invalid_components'; END IF;
 IF (SELECT count(*)<>count(DISTINCT x->>'ordinal') OR sum((x->>'amount')::numeric)<>amount FROM jsonb_array_elements(components) x) THEN RAISE EXCEPTION 'component_total'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(components) x LEFT JOIN accounting.lines l ON l.tenant_id=t AND l.company_id=c AND l.journal_id=j AND l.ordinal=(x->>'ordinal')::integer WHERE l.ordinal IS NULL OR l.ordinal=0 OR l.account_id<>x->>'account_id') THEN RAISE EXCEPTION 'component_source'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(components) x JOIN accounting.lines l ON l.tenant_id=t AND l.company_id=c AND l.journal_id=j AND l.ordinal=(x->>'ordinal')::integer WHERE (x->>'amount')::numeric+coalesce((SELECT sum((v->>'amount')::numeric) FROM (SELECT p.components FROM accounting.allocations p LEFT JOIN accounting.allocation_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.allocation_id=p.id WHERE p.tenant_id=t AND p.company_id=c AND p.document_id=doc AND r.allocation_id IS NULL UNION ALL SELECT p.components FROM accounting.credits p LEFT JOIN accounting.credit_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.credit_id=p.id WHERE p.tenant_id=t AND p.company_id=c AND p.document_id=doc AND r.credit_id IS NULL) p CROSS JOIN LATERAL jsonb_array_elements(p.components) v WHERE v->>'ordinal'=x->>'ordinal'),0)>abs(l.amount)) THEN RAISE EXCEPTION 'component_overallocated'; END IF;
END $$;
CREATE FUNCTION accounting.guard_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d accounting.documents; paid numeric; movement numeric;
BEGIN
 PERFORM 1 FROM accounting.books WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id FOR UPDATE;
 SELECT * INTO STRICT d FROM accounting.documents WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.document_id;
 IF d.journal_id IS NULL OR d.void_journal_id IS NOT NULL THEN RAISE EXCEPTION 'document_unapproved_or_void'; END IF;
 SELECT coalesce(sum(a.amount),0) INTO paid FROM accounting.allocations a LEFT JOIN accounting.allocation_reversals r ON r.tenant_id=a.tenant_id AND r.company_id=a.company_id AND r.allocation_id=a.id WHERE a.tenant_id=NEW.tenant_id AND a.company_id=NEW.company_id AND a.document_id=NEW.document_id AND r.allocation_id IS NULL;
 IF paid+NEW.amount>d.total THEN RAISE EXCEPTION 'overpayment'; END IF;
 IF EXISTS(SELECT 1 FROM accounting.journals j WHERE j.tenant_id=NEW.tenant_id AND j.company_id=NEW.company_id AND j.id=NEW.journal_id AND (j.effective_date<d.issued OR j.effective_date<accounting.latest_settlement_date(NEW.tenant_id,NEW.company_id,NEW.document_id))) THEN RAISE EXCEPTION 'payment_before_history'; END IF;
 SELECT sum(l.amount) INTO movement FROM accounting.lines l JOIN accounting.journals j ON j.tenant_id=l.tenant_id AND j.company_id=l.company_id AND j.id=l.journal_id WHERE l.tenant_id=NEW.tenant_id AND l.company_id=NEW.company_id AND l.journal_id=NEW.journal_id AND l.account_id=d.control_account AND j.state='POSTED' AND j.source='payment' AND j.currency=d.currency;
 IF movement IS NULL OR movement<>NEW.amount*(CASE WHEN d.kind='invoice' THEN -1 ELSE 1 END) THEN RAISE EXCEPTION 'allocation_posting_mismatch'; END IF;
 IF EXISTS(SELECT 1 FROM accounting.allocations WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=NEW.journal_id) THEN RAISE EXCEPTION 'payment_already_allocated'; END IF;
 PERFORM accounting.assert_components(NEW.tenant_id,NEW.company_id,NEW.document_id,NEW.amount,NEW.components);
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_guard BEFORE INSERT ON accounting.allocations FOR EACH ROW EXECUTE FUNCTION accounting.guard_allocation();
CREATE FUNCTION accounting.guard_allocation_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM accounting.allocations a JOIN accounting.journals j ON j.tenant_id=a.tenant_id AND j.company_id=a.company_id AND j.reversal_of=a.journal_id WHERE a.tenant_id=NEW.tenant_id AND a.company_id=NEW.company_id AND a.id=NEW.allocation_id AND j.id=NEW.journal_id AND j.source='payment_reversal' AND j.state='POSTED') THEN RAISE EXCEPTION 'invalid_allocation_reversal'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER allocation_reversal_guard BEFORE INSERT ON accounting.allocation_reversals FOR EACH ROW EXECUTE FUNCTION accounting.guard_allocation_reversal();
CREATE FUNCTION accounting.guard_credit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d accounting.documents; j accounting.journals; settled numeric; sign numeric;
BEGIN
 PERFORM 1 FROM accounting.books WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id FOR UPDATE;
 SELECT * INTO STRICT d FROM accounting.documents WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.document_id;
 SELECT * INTO STRICT j FROM accounting.journals WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND id=NEW.journal_id;
 IF d.journal_id IS NULL OR d.void_journal_id IS NOT NULL OR j.source<>'credit' OR j.state<>'POSTED' OR j.currency<>d.currency THEN RAISE EXCEPTION 'invalid_credit'; END IF;
 IF j.effective_date<d.issued OR j.effective_date<accounting.latest_settlement_date(NEW.tenant_id,NEW.company_id,NEW.document_id) THEN RAISE EXCEPTION 'credit_before_history'; END IF;
 SELECT sum(amount) INTO settled FROM (
  SELECT p.amount FROM accounting.allocations p LEFT JOIN accounting.allocation_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.allocation_id=p.id WHERE p.tenant_id=NEW.tenant_id AND p.company_id=NEW.company_id AND p.document_id=d.id AND r.allocation_id IS NULL
  UNION ALL SELECT p.amount FROM accounting.credits p LEFT JOIN accounting.credit_reversals r ON r.tenant_id=p.tenant_id AND r.company_id=p.company_id AND r.credit_id=p.id WHERE p.tenant_id=NEW.tenant_id AND p.company_id=NEW.company_id AND p.document_id=d.id AND r.credit_id IS NULL
 ) p;
 IF coalesce(settled,0)+NEW.amount>d.total THEN RAISE EXCEPTION 'overcredit'; END IF;
 PERFORM accounting.assert_components(NEW.tenant_id,NEW.company_id,NEW.document_id,NEW.amount,NEW.components);
 sign:=CASE WHEN d.kind='invoice' THEN 1 ELSE -1 END;
 IF (SELECT count(*) FROM accounting.lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=j.id)<>jsonb_array_length(NEW.components)+1
 OR EXISTS((SELECT ordinal,account_id,amount FROM accounting.lines WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id AND journal_id=j.id) EXCEPT (SELECT 0,d.control_account,-sign*NEW.amount UNION ALL SELECT ordinality::integer,x->>'account_id',sign*(x->>'amount')::numeric FROM jsonb_array_elements(NEW.components) WITH ORDINALITY AS p(x,ordinality))) THEN RAISE EXCEPTION 'credit_posting_mismatch'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credit_guard BEFORE INSERT ON accounting.credits FOR EACH ROW EXECUTE FUNCTION accounting.guard_credit();
CREATE FUNCTION accounting.guard_credit_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM accounting.credits p JOIN accounting.journals j ON j.tenant_id=p.tenant_id AND j.company_id=p.company_id AND j.reversal_of=p.journal_id WHERE p.tenant_id=NEW.tenant_id AND p.company_id=NEW.company_id AND p.id=NEW.credit_id AND j.id=NEW.journal_id AND j.source='credit_reversal' AND j.state='POSTED') THEN RAISE EXCEPTION 'invalid_credit_reversal'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credit_reversal_guard BEFORE INSERT ON accounting.credit_reversals FOR EACH ROW EXECUTE FUNCTION accounting.guard_credit_reversal();
CREATE INDEX accounting_credits_document ON accounting.credits(tenant_id,company_id,document_id);
CREATE FUNCTION accounting.guard_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.locked_through IS NOT NULL AND (NEW.locked_through IS NULL OR NEW.locked_through<OLD.locked_through) THEN RAISE EXCEPTION 'period_reopen_requires_separate_authority'; END IF;
 IF (to_jsonb(OLD)-ARRAY['revision','locked_through'])<>(to_jsonb(NEW)-ARRAY['revision','locked_through']) THEN RAISE EXCEPTION 'book_identity_immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER book_guard BEFORE UPDATE ON accounting.books FOR EACH ROW EXECUTE FUNCTION accounting.guard_lock();
CREATE FUNCTION accounting.guard_unmatch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE b accounting.books;
BEGIN
 SELECT * INTO STRICT b FROM accounting.books WHERE tenant_id=NEW.tenant_id AND company_id=NEW.company_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM accounting.matches m JOIN accounting.statements s ON s.tenant_id=m.tenant_id AND s.company_id=m.company_id AND s.id=m.statement_id JOIN accounting.journals j ON j.tenant_id=m.tenant_id AND j.company_id=m.company_id AND j.id=m.journal_id WHERE m.tenant_id=NEW.tenant_id AND m.company_id=NEW.company_id AND m.id=NEW.match_id AND (s.effective_date<=b.locked_through OR j.effective_date<=b.locked_through)) THEN RAISE EXCEPTION 'period_locked'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER unmatch_guard BEFORE INSERT ON accounting.match_reversals FOR EACH ROW EXECUTE FUNCTION accounting.guard_unmatch();
CREATE FUNCTION accounting.guard_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'account_delete_forbidden'; END IF;
 PERFORM 1 FROM accounting.books WHERE tenant_id=OLD.tenant_id AND company_id=OLD.company_id FOR UPDATE;
 IF (to_jsonb(OLD)-'active')<>(to_jsonb(NEW)-'active') OR NOT OLD.active OR NEW.active THEN RAISE EXCEPTION 'account_identity_immutable'; END IF;
 IF OLD.control IS NOT NULL THEN RAISE EXCEPTION 'protected_account'; END IF;
 IF EXISTS(SELECT 1 FROM accounting.lines WHERE tenant_id=OLD.tenant_id AND company_id=OLD.company_id AND account_id=OLD.id)
  OR EXISTS(SELECT 1 FROM accounting.documents d WHERE d.tenant_id=OLD.tenant_id AND d.company_id=OLD.company_id AND (d.control_account=OLD.id OR EXISTS(SELECT 1 FROM jsonb_array_elements(d.lines) l WHERE l->>'account_id'=OLD.id OR l->>'tax_account'=OLD.id)))
  OR EXISTS(SELECT 1 FROM accounting.statements WHERE tenant_id=OLD.tenant_id AND company_id=OLD.company_id AND bank_account=OLD.id) THEN RAISE EXCEPTION 'account_in_use'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER account_guard BEFORE UPDATE OR DELETE ON accounting.accounts FOR EACH ROW EXECUTE FUNCTION accounting.guard_account();
CREATE INDEX accounting_allocations_document ON accounting.allocations(tenant_id,company_id,document_id);
CREATE INDEX accounting_allocations_journal ON accounting.allocations(tenant_id,company_id,journal_id);
CREATE INDEX accounting_matches_statement ON accounting.matches(tenant_id,company_id,statement_id);
CREATE INDEX accounting_matches_journal ON accounting.matches(tenant_id,company_id,journal_id,ordinal);
CREATE FUNCTION accounting.immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'record_immutable'; END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['statement_imports','document_versions','credits','credit_reversals','allocations','allocation_reversals','statements','matches','match_reversals','commands','events'] LOOP
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON accounting.%I FOR EACH ROW EXECUTE FUNCTION accounting.immutable()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['books','accounts','journals','lines','documents','statement_imports','document_versions','credits','credit_reversals','allocations','allocation_reversals','statements','matches','match_reversals','commands','events'] LOOP
  EXECUTE format('ALTER TABLE accounting.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE accounting.%I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY company_isolation ON accounting.%I TO accounting_fixture USING (tenant_id=current_setting(''accounting.tenant'',true) AND company_id=current_setting(''accounting.company'',true)) WITH CHECK (tenant_id=current_setting(''accounting.tenant'',true) AND company_id=current_setting(''accounting.company'',true))',t);
 END LOOP;
END $$;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA accounting TO accounting_fixture;
GRANT UPDATE ON accounting.books, accounting.journals, accounting.documents TO accounting_fixture;
GRANT UPDATE(active) ON accounting.accounts TO accounting_fixture;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA accounting FROM PUBLIC;
GRANT EXECUTE ON FUNCTION accounting.assert_components(text,text,text,numeric,jsonb) TO accounting_fixture;

GRANT EXECUTE ON FUNCTION accounting.latest_settlement_date(text,text,text) TO accounting_fixture;

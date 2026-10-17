# Verified production constraints: sandy_qa_engineering_handoffs

Catalog snapshot, not migration SQL.

- `sandy_qa_engineering_handoffs_issue_key_fkey`: `FOREIGN KEY (issue_key) REFERENCES sandy_evidence_improvement_queue(issue_key)`
- `sandy_qa_engineering_handoffs_issue_key_key`: `UNIQUE (issue_key)`
- `sandy_qa_engineering_handoffs_pkey`: `PRIMARY KEY (id)`
- `sandy_qa_engineering_handoffs_status_check`: `CHECK ((status = ANY (ARRAY['investigation_ready'::text, 'investigating'::text, 'fix_proposed'::text, 'awaiting_approval'::text, 'deployed'::text, 'verification_pending'::text, 'verified'::text, 'blocked'::text])))`

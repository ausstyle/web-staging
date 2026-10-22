BEGIN;
-- Explicit owner-approved canary delegation established through protected
-- Management administration, version 6. No new operation, authority or provider
-- verification is created here. Guest v17 admits only exact standing-policy
-- canaries while unverified; normal manual/customer mutation gates remain.
-- Source: immutable proposal 11636b525119327ce794f87975c291c24232db35.
DO $$ DECLARE matched integer; BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.sandy_engineering_standing_delegations
 WHERE identity_user_id='7a519da9-2ee3-4edf-adec-42697da5a560' AND version=6
 AND source_sha256='71451e7b0a092b28e99b60075711d879c29f4134a1b2473ab0c8998be72b2555' AND revoked_at IS NULL AND expires_at>clock_timestamp()
 AND source_commit='384b07258a99db03fd5e41fd5cf7ee5c356045c7')
 THEN RAISE EXCEPTION 'approved_canary_delegation_required';END IF;
 WITH expected(operation,sha) AS (VALUES
 ('gcp.vm.files.upload','32b66e724903eac8058c8e3e1beea78038cc1a23f16c13be13d1500c27b7d392'),
 ('gcp.vm.files.download','50c9490e3ab0d4fba287595c992ee709190950021c82550fcf3b9589be0504f2'),
 ('gcp.vm.packages.install','cf1747fa6e68fe80c4edd628127b0758caddd86ebd528a5f2c61b8a42961891a'),
 ('gcp.vm.packages.update','2bde8eb1767af9cb37398500057bf08fd0e62d88f7c94bfdeb08e132be5b36ff'),
 ('gcp.vm.packages.remove','ea511a6e3e19fbffc1b6791974c040ac2378910d7b1cefa8a961107fab31b9bf'),
 ('gcp.vm.services.start','dcba46fd88066d4ae5678f944000711fa490fa19da99ba028b74a0cd45fcdf33'),
 ('gcp.vm.services.stop','28bc272daffb9fa124c2057256a1ace529e3c5a39815a87ee841cb34d8d01ed5'),
 ('gcp.vm.services.restart','2ea7dba0bf304c1fea816b7b189fc50a76c2da5f78f653f669595eade1163159'),
 ('gcp.vm.services.status','d05f8eaf9c6052ac92b57872d0a89b18c70e1130a1106a3a503620bbe5b48e8c'),
 ('gcp.vm.tasks.get','74c9dafbee4d383c18bb686ba08596b1d427a106253406f42e52da6caa3124e5')
 ) SELECT count(*) INTO matched FROM expected e
 JOIN public.sandy_engineering_operation_classes c USING(operation)
 JOIN public.sandy_operation_registry r USING(operation)
 WHERE c.contract_sha256=e.sha AND r.error_contract->>'contract_sha256'=e.sha
 AND c.source_path='supabase/functions/sandy-guest-operation-api/contracts.json'
 AND c.operation_class IN('guest_read','guest_files_write','guest_services_write','guest_packages_write')
 AND r.handler='sandy-guest-operation-api' AND r.verified=false
 AND r.api_exposed=false AND r.ai_exposed=false;
 IF matched<>10 THEN RAISE EXCEPTION 'reviewed_canary_contract_preimage_changed';END IF;
 UPDATE public.sandy_operation_registry SET api_exposed=true,ai_exposed=true
 WHERE operation=ANY(ARRAY['gcp.vm.files.upload','gcp.vm.files.download','gcp.vm.packages.install','gcp.vm.packages.update','gcp.vm.packages.remove','gcp.vm.services.start','gcp.vm.services.stop','gcp.vm.services.restart','gcp.vm.services.status','gcp.vm.tasks.get']);
END $$;
-- Rollback: restore only these ten exposure flags from the release preimage,
-- with conflict checks. Preserve policy versions, audit and unknown outcomes.
-- Enrollment, installer, native transport, IAM and graphical operations remain
-- excluded from this standing authority. verified/last_verified_at unchanged.
COMMIT;

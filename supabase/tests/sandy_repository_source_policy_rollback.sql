-- Run after the source-read migrations. No provider calls or persistent changes.
BEGIN;
DO $$
DECLARE p jsonb; s jsonb; name text;
BEGIN
 p:='{"resources":{"github":["ausstyle/web-staging"]},"classes":{"github":["source_read","code_write"]}}';
 s:='{"provider":"github","repository":"ausstyle/web-staging"}';
 FOREACH name IN ARRAY ARRAY['.gitignore','.github/workflows/sandy-runtime-release-checks.yml','nested/.editorconfig'] LOOP
  IF NOT public.sandy_engineering_policy_target(p,'github.files.content.get',jsonb_build_object('path',jsonb_build_object('path',name),'query',jsonb_build_object('ref',repeat('a',40))),s)
  THEN RAISE EXCEPTION 'reviewed_dotfile_read_denied: %',name;END IF;
 END LOOP;
 FOREACH name IN ARRAY ARRAY['.env','.git/config','nested/../outside','private-key.json'] LOOP
  IF public.sandy_engineering_policy_target(p,'github.files.content.get',jsonb_build_object('path',jsonb_build_object('path',name),'query',jsonb_build_object('ref',repeat('a',40))),s)
  THEN RAISE EXCEPTION 'unsafe_source_read_allowed: %',name;END IF;
 END LOOP;
 IF public.sandy_engineering_policy_target(p,'github.files.update','{"path":{"path":".github/workflows/release.yml"},"body":{"branch":"engineering/source-test"}}',s)
 THEN RAISE EXCEPTION 'workflow_write_authority_expanded';END IF;
END $$;
ROLLBACK;

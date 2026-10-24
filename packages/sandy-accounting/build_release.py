"""Prepare an inspectable source bundle; does not register, migrate or deploy it."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys
import tarfile

ROOT=Path(__file__).resolve().parents[2]
OUT=Path(sys.argv[1] if len(sys.argv)>1 else '/tmp/sandy-accounting-release')
OUT.mkdir(parents=True,exist_ok=True)
paths=[]
for directory in ['packages/sandy-accounting','docs/sandy-accounting']:
    for p in (ROOT/directory).rglob('*'):
        if p.is_file() and not any(x in p.parts for x in ['node_modules','__pycache__','.local-books']) and p.suffix!='.docx':paths.append(p)
paths.extend([ROOT/'docs/sandy-engineering/tasks/SANDY-ENG-0013-sandy-accounting.md',ROOT/'.github/workflows/sandy-accounting-checks.yml'])
revision=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
dirty=subprocess.check_output(['git','status','--porcelain','--','packages/sandy-accounting','docs/sandy-accounting','.github/workflows/sandy-accounting-checks.yml'],cwd=ROOT,text=True)
if dirty:raise SystemExit('Commit scoped source before producing a release artifact.')
manifest={'scope_id':'SANDY-ENG-0013','scope_version':'1.1','source_commit':revision,'source_repository':'ausstyle/web-staging','classification':'INTERNAL_ALPHA_LOCAL_SYNTHETIC','deployed':False,'independently_accepted':False,'installation_gate':'Canonical identity/company/file/admission adapter, scoped existing staging target, SQL tenancy/roles and owner-coordinated release required.','files':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(paths))}}
(OUT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
with tarfile.open(OUT/'accounting-source.tar.gz','w:gz') as tar:
    for p in sorted(set(paths)):tar.add(p,arcname=str(p.relative_to(ROOT)))
(OUT/'SHA256SUMS').write_text(''.join(hashlib.sha256((OUT/name).read_bytes()).hexdigest()+'  '+name+'\n' for name in ['manifest.json','accounting-source.tar.gz']))
print(json.dumps({'source_commit':revision,'files':len(manifest['files']),'output':str(OUT),'deployed':False}))

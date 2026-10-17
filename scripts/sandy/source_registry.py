#!/usr/bin/env python3
"""Deterministic local source-availability registry (no production credentials)."""
import hashlib
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FUNCTIONS = ROOT / "supabase/functions"
REFERENCE_DIR = ROOT / "docs/sandy-qa"

def inventory():
    entries = []
    if FUNCTIONS.exists():
        for folder in sorted(FUNCTIONS.iterdir()):
            if folder.is_dir() and (folder / "index.ts").is_file():
                path = folder / "index.ts"
                entries.append({"type":"edge_function","name":folder.name,"path":str(path.relative_to(ROOT)),"sha256":hashlib.sha256(path.read_bytes()).hexdigest(),"verified_production_parity":False})
    if REFERENCE_DIR.exists():
        for file in sorted(REFERENCE_DIR.glob("*.sql")):
            data = file.read_text(errors="replace")
            for name in sorted(set(re.findall(r"(?i)CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?([A-Za-z_][A-Za-z_0-9]*)",data))):
                entries.append({"type":"database_routine","name":name,"path":str(file.relative_to(ROOT)),"sha256":hashlib.sha256(file.read_bytes()).hexdigest(),"verified_production_parity":False})
    return entries

def assess(deps, entries):
    lookup = {(x["type"],x["name"]):x for x in entries}
    result=[]
    for item in deps:
        kind=item.get("type")
        name=item.get("name")
        if not isinstance(kind,str) or not isinstance(name,str) or not re.fullmatch(r"[A-Za-z0-9_./-]{1,140}",name):
            continue
        entry=lookup.get((kind,name))
        result.append({"type":kind,"name":name,"status":"repository_present_unverified" if entry else "requires_authorized_retrieval","path":entry["path"] if entry else None})
    return result

if __name__=="__main__":
    entries=inventory()
    result={"schema_version":1,"scope":"repository_only","production_parity_certified":False,"entries":entries}
    if len(sys.argv)>1:
        deps=json.loads(Path(sys.argv[1]).read_text())["dependencies"]
        result["dependency_assessment"]=assess(deps,entries)
    print(json.dumps(result,indent=2,sort_keys=True))

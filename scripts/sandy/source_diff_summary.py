#!/usr/bin/env python3
"""Compute a no-source-text diff summary inside the approved isolated runner."""
import difflib
import json
import pathlib
import re
import sys

def summarize(prod_dir, repo_dir, comparison, screen):
    slug = comparison.get("function_slug")
    if not isinstance(slug, str) or not re.fullmatch(r"sandy-[a-z0-9-]{1,80}", slug):
        raise ValueError("Invalid function")
    if comparison.get("project_ref") != "zmqlyygzqoidkcwdysok" or screen.get("function_slug") != slug:
        raise ValueError("Source identity mismatch")
    if screen.get("publication_authorized") is not False or comparison.get("production_parity_certified") is not False:
        raise ValueError("Unsafe source publication assertion")
    prod, repo = pathlib.Path(prod_dir).resolve(), pathlib.Path(repo_dir).resolve()
    if prod.name != slug or repo.name != slug:
        raise ValueError("Source directory identity mismatch")
    files = comparison.get("files")
    if not isinstance(files, list) or len(files) > 160:
        raise ValueError("Invalid comparison")
    results=[]
    for item in files:
        if not isinstance(item, dict):
            raise ValueError("Invalid file entry")
        name,status=item.get("path"),item.get("status")
        if not isinstance(name,str) or not re.fullmatch(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*",name) or ".." in name.split("/"):
            raise ValueError("Invalid path")
        if status not in {"hash_match","hash_mismatch","missing_in_repository","not_in_audited_bundle"}:
            raise ValueError("Invalid file status")
        a,b=prod/name,repo/name
        if a.is_symlink() or b.is_symlink():
            raise ValueError("Symlink")
        if (a.is_file() and a.stat().st_size>2_000_000) or (b.is_file() and b.stat().st_size>2_000_000):
            raise ValueError("Oversized file")
        before=b.read_bytes().decode("utf-8",errors="replace").splitlines() if b.is_file() else []
        after=a.read_bytes().decode("utf-8",errors="replace").splitlines() if a.is_file() else []
        operations=difflib.SequenceMatcher(None,before,after,autojunk=False).get_opcodes()
        added=sum(j2-j1 for tag,i1,i2,j1,j2 in operations if tag in ("insert","replace"))
        removed=sum(i2-i1 for tag,i1,i2,j1,j2 in operations if tag in ("delete","replace"))
        results.append({"path":name,"comparison_status":status,"added_lines":added,"removed_lines":removed})
    return {"schema_version":1,"function_slug":slug,"publication_authorized":False,
            "source_contents_included":False,"production_parity_certified":False,
            "review_required":True,"files":results}

if __name__=="__main__":
    m=json.loads(pathlib.Path(sys.argv[3]).read_text())
    s=json.loads(pathlib.Path(sys.argv[4]).read_text())
    print(json.dumps(summarize(sys.argv[1],sys.argv[2],m,s),indent=2))

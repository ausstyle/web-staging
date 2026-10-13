#!/usr/bin/env python3
"""Recover WAM Capital monthly pre-tax NTA from text- or image-based issuer PDFs.
Outputs candidates and manual-review cases. Does not silently write to the database.
"""
import re, io, csv, os, requests
import fitz
from PIL import Image
import pytesseract
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
BASE="https://zwrywwrdnznilgasfjuu.supabase.co/functions/v1/"
s=requests.Session()
docs=s.get(BASE+"wam-documents-api",timeout=45).json()["documents"]
obs=s.get(BASE+"lic-nta-api",timeout=45).json()["observations"]
existing={v["month_end"][:7] for v in obs}
monthnames={m.lower():i+1 for i,m in enumerate(["January","February","March","April","May","June","July","August","September","October","November","December"])}
reports=[]
for d in docs:
 if d.get("document_type")!="Monthly investment update" or not d.get("stored_pdf_url"):continue
 mat=re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December)\s*[- ]\s*(19\d\d|20\d\d)",d["title"],re.I)
 if not mat:continue
 m=f'{int(mat.group(2)):04d}-{monthnames[mat.group(1).lower()]:02d}'
 if m in existing:continue
 reports.append((m,d))
print("Missing monthly candidates",len(reports),flush=True)
def ocr(item):
 period,d=item
 name=d["title"]
 try:
  r=requests.get(d["stored_pdf_url"],timeout=50)
  r.raise_for_status()
  pdf=fitz.open(stream=r.content,filetype="pdf")
  if not len(pdf):raise RuntimeError("No pages")
  first=pdf[0]
  # Prefer rendered text before OCR; always OCR when sparse.
  native=first.get_text()
  if len(native.strip())>550:text=native
  else:
   pix=first.get_pixmap(matrix=fitz.Matrix(2.0,2.0),alpha=False)
   image=Image.open(io.BytesIO(pix.tobytes("png")))
   text=pytesseract.image_to_string(image,config="--psm 3")
  text=text.replace("\r","\n")
  # Check internal report header; archive mislabels are known.
  title_date=re.search(r"(January|February|March|April|May|June|July|August|September|October|November|December)\s+([12][09]\d\d)",text[:4500],re.I)
  if title_date:
   actual=f'{title_date.group(2)}-{monthnames[title_date.group(1).lower()]:02d}'
   if actual!=period:return [period,name,"MISMATCH",None,None,"internal month "+actual,d["stored_pdf_url"],text[:850]]
  # Examples: 'Pre-tax net tangible assets $1.57', 'NTA before tax 157.3c', 'Pre-tax NTA $1.53 $1.48 ...'
  patterns=[
   (r"pre[\s-]*tax\s+net\s+tangible\s+assets\s*[:\-]?\s*\$\s*(\d\.\d{2,4})",1),
   (r"NTA\s+before\s+tax(?:\s+payable\s+and\s+after\s+tax\s+assets)?\s*[:\-]?\s*\*{0,2}\s*(\d{2,3}\.\d{1,4})\s*c",.01),
   (r"pre[\s-]*tax\s+NTA\s*(?:\(ex.dividend\))?\s*\$\s*(\d\.\d{2,4})",1),
  ]
  pres=[]
  for pat,mult in patterns:
   for ma in re.finditer(pat,text[:6000],re.I|re.S):
    value=float(ma.group(1))*mult
    if .6<value<4:
     pres.append((value,ma.group(0)))
  if not pres:
   # Some Wilson multi-LIC reports show 'Pre-tax NTA $1.50 $1.25 $2.21' in first row; WAM first.
   ma=re.search(r"Pre.tax\s+NTA\s*\n\s*\$?\s*(\d\.\d\d)\s*\n\s*\$\d",text[:2700],re.I)
   if ma:pres=[(float(ma.group(1)),ma.group(0))]
  if not pres:return [period,name,"REVIEW",None,None,"NTA number not extracted",d["stored_pdf_url"],text[:850]]
  if max(x[0] for x in pres)-min(x[0] for x in pres)>.04:return [period,name,"REVIEW",None,None,"conflicting pre-tax values "+str(pres[:5]),d["stored_pdf_url"],text[:850]]
  pre=pres[0][0]
  post=None
  for pat,mult in [(r"NTA\s+after\s+tax\s*\*{0,2}\s*(\d{2,3}\.\d{1,4})\s*c",.01),(r"post[\s-]*tax\s+net\s+tangible\s+assets\s*\$?\s*(\d\.\d{2,4})",1)]:
   ma=re.search(pat,text[:6500],re.I)
   if ma:post=float(ma.group(1))*mult;break
  return [period,name,"CANDIDATE",round(pre,4),round(post,4) if post else None,pres[0][1][:120],d["stored_pdf_url"],text[:850]]
 except Exception as e:
  return [period,name,"ERROR",None,None,str(e)[:250],d["stored_pdf_url"],""]
rows=[]
with ThreadPoolExecutor(max_workers=5) as pool:
 for f in as_completed([pool.submit(ocr,r) for r in reports]):
  rows.append(f.result())
  if len(rows)%15==0:print("Processed",len(rows),flush=True)
rows.sort()
os.makedirs("asx-atlas/analysis",exist_ok=True)
with open("asx-atlas/analysis/wam-nta-ocr-candidates.csv","w",newline="") as out:
 w=csv.writer(out);w.writerow(["month","title","status","pre_tax","post_tax","evidence","pdf_url","text_excerpt"]);w.writerows(rows)
from collections import Counter
print("DONE",Counter(r[2] for r in rows),flush=True)

# Extraction rerun: 2026-10-13 source coverage audit

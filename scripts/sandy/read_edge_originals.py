"""Read original TypeScript from the two deployed ESZIP source naming formats."""
import json
import re
import struct
from release_web_canary import Blocked, original_sources

def whatsapp_original_sources(bundle):
    modern=original_sources(bundle)
    if modern:return modern
    position=8
    def section():
        nonlocal position
        if position+4>len(bundle):raise Blocked('truncated_deployed_bundle')
        size=int.from_bytes(bundle[position:position+4],'big');position+=4
        if size>len(bundle)-position:raise Blocked('truncated_deployed_bundle')
        result=bundle[position:position+size];position+=size;return result
    if bundle[:8]!=b'ESZIP2.3' or section()!=bytes([0,0,1,0]):raise Blocked('unsupported_deployed_bundle')
    header=section();section();source=section();maps=section();offset=0;result={}
    while offset<len(header):
        if offset+4>len(header):raise Blocked('truncated_deployed_header')
        size=int.from_bytes(header[offset:offset+4],'big');offset+=4
        if offset+size+1>len(header):raise Blocked('truncated_deployed_header')
        name=header[offset:offset+size].decode();offset+=size;kind=header[offset];offset+=1
        if kind==0:
            if offset+17>len(header):raise Blocked('truncated_deployed_header')
            so,ss,mo,ms=struct.unpack_from('>IIII',header,offset);offset+=17
            if not name.startswith(('sandy-whatsapp-webhook/','_shared/')):continue
            if not re.fullmatch(r'[A-Za-z0-9_./-]+',name) or '..' in name or name in result:raise Blocked('ambiguous_deployed_source')
            if so+ss>len(source) or not ms or mo+ms>len(maps):raise Blocked('original_deployed_source_unavailable')
            try:mapping=json.loads(maps[mo:mo+ms])
            except (ValueError,UnicodeError):raise Blocked('invalid_original_source_map') from None
            contents=mapping.get('sourcesContent')
            if mapping.get('sources')!=[name] or not isinstance(contents,list) or len(contents)!=1 or not isinstance(contents[0],str):raise Blocked('ambiguous_deployed_source')
            result[name]=contents[0].encode()
        elif kind==1:
            if offset+4>len(header):raise Blocked('truncated_deployed_header')
            size=int.from_bytes(header[offset:offset+4],'big');offset+=4+size
            if offset>len(header):raise Blocked('truncated_deployed_header')
        elif kind==2:
            offset+=4
            if offset>len(header):raise Blocked('truncated_deployed_header')
        else:raise Blocked('unsupported_deployed_module')
    if 'sandy-whatsapp-webhook/index.ts' not in result:raise Blocked('original_deployed_entrypoint_unavailable')
    return result

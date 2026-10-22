"""Constrained real-local protocol/handler regression; not Edge/provider attestation."""
import json,os,pathlib,shutil,subprocess,sys,time
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[2]
OUT=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else '/tmp');OUT.mkdir(parents=True,exist_ok=True)
deno=os.environ.get('DENO_BIN') or shutil.which('deno') or '/workspace/.cloud-setup/toolchain/node_modules/.bin/deno'
limit=int(sys.argv[2]) if len(sys.argv)>2 else 96
command=[deno,'test','--no-check','--v8-flags=--max-old-space-size='+str(limit),'--allow-read','--allow-env','--allow-write=/tmp','--allow-run=openssl','--allow-net=127.0.0.1']+[str(HERE/(name+'_test.ts'))for name in ['index','ssh','winrm','provider']]
started=time.monotonic();label='vm-protocol-stress-'+str(limit)
with(OUT/(label+'.log')).open('w')as log:
 child=subprocess.Popen(command,cwd=ROOT,env={**os.environ,'DENO_DIR':os.environ.get('DENO_DIR','/workspace/.cloud-setup/deno-cache')},stdout=log,stderr=subprocess.STDOUT)
 _,status,usage=os.wait4(child.pid,0);child.returncode=os.waitstatus_to_exitcode(status)
evidence={'exit_code':child.returncode,'heap_limit_mib':limit,'peak_rss_bytes':usage.ru_maxrss*1024,'rss_measurement':'os.wait4 exact Deno child','wall_seconds':round(time.monotonic()-started,3),'type_checking':'performed separately without runtime heap constraint','actual_local_ssh_and_tls':True,'actual_provider_network':False,'actual_controller_session':False,'edge_memory_or_concurrency_attested':False}
(OUT/(label+'.json')).write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence));sys.exit(0 if child.returncode==0 else 1)

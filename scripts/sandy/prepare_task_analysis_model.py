"""Prepare only the reviewed v20 task-analysis source delta; never deploy/call a model."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[2]
BEFORE_SHA='797361b54aee283eb4d13825ef969fe23052fa21d626470c88f7ef24f1cd4a31'
AFTER_SHA='badf527de90ff0060cb5e6ebfced55b74a5269357c9c7f45b94accc46d22dda3'
MODULES=('task_analysis_model.ts','task_analysis_profile.ts','runtime_model_metrics.ts','worker_model_result.ts')
def sha(value):return hashlib.sha256(value).hexdigest()
def candidate(files):
 if set(files)!={'sandy-task-analysis-worker/index.ts'} or sha(files['sandy-task-analysis-worker/index.ts'])!=BEFORE_SHA:raise ValueError('reviewed_actual_worker20_single_module_preimage_required')
 # Verify every non-model worker operation remains identical. No queue/auth,
 # scheduler, task/customer mutation, dispatch or trigger change is admitted.
 before=files['sandy-task-analysis-worker/index.ts'].decode();after=(ROOT/'supabase/functions/sandy-task-analysis-worker/index.ts').read_text()
 if sha(after.encode())!=AFTER_SHA:raise ValueError('reviewed_worker_entrypoint_changed')
 before_extract=before[before.index('async function extract('):before.index('function scheduled(')]
 after_extract=after[after.index('async function extract('):after.index('function scheduled(')]
 normalized=after.replace('import {extractTaskConfiguration} from "../_shared/sandy-agent-operations/task_analysis_model.ts";\n','').replace('import {literalTaskTitle} from "../_shared/sandy-agent-operations/task_analysis_profile.ts";\n','')
 normalized=normalized.replace('function taskAnalysisFailure(error:unknown){const value=error instanceof Error?error.message:"task_analysis_failed";return /^[a-z0-9_]{1,100}$/.test(value)?value:"task_analysis_failed_or_unknown";}\n','').replace(after_extract,before_extract).replace('extract(task.title,job.task_id,job.customer_id)','extract(task.title)').replace('String(x?.timezone).toUpperCase()','String(x.timezone).toUpperCase()').replace('last_error:taskAnalysisFailure(e)','last_error:String(e).slice(0,600)')
 if normalized!=before:raise ValueError('unreviewed_non_model_worker_delta')
 result={'sandy-task-analysis-worker/index.ts':after.encode()}
 for module in MODULES:result['_shared/sandy-agent-operations/'+module]=(ROOT/'supabase/functions/_shared/sandy-agent-operations'/module).read_bytes()
 return result

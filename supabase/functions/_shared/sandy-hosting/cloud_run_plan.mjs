/** Read-only desired-state preparation. Not an admitted job or provider request.
 * Service/RevisionTemplate schema checked against Google's v2 reference 2026-10-24.
 * https://docs.cloud.google.com/run/docs/reference/rest/v2/projects.locations.services
 */
import {createHash} from 'node:crypto';
const project='elaborate-haven-511518-a5',region='europe-west8';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(x);
const fail=s=>{throw Error(s)};
const exact=(o,keys)=>{if(!o||typeof o!=='object'||Array.isArray(o)||Object.keys(o).length!==keys.length||keys.some(k=>!Object.hasOwn(o,k)))fail('exact_fields_required')};
export function hostingServiceName(tenant,site){if(!uuid(tenant)||!uuid(site))fail('tenant_site_binding_required');return 'sh-'+digest([tenant,site]).slice(0,40);}
/** binding and inventory must come from trusted server records/adapters, not caller claims.
 * Absent inventory is not assumed: require a recent authoritative absence receipt.
 * Existing services require the separate etag/traffic-preserving update flow.
 */
export function planCloudRunCreate({binding,artifact,limits,inventory,now}){
 exact(binding,['tenant_id','site_id','project','region','service_account']);
 if(binding.project!==project||binding.region!==region)fail('hosting_target_mismatch');
 const serviceId=hostingServiceName(binding.tenant_id,binding.site_id);
 const name=`projects/${project}/locations/${region}/services/${serviceId}`;
 if(typeof binding.service_account!=='string'||!/^sh-[a-f0-9]{20}@elaborate-haven-511518-a5\.iam\.gserviceaccount\.com$/.test(binding.service_account))fail('site_specific_identity_required');
 if(binding.service_account!==`sh-${digest([binding.tenant_id,binding.site_id]).slice(0,20)}@${project}.iam.gserviceaccount.com`)fail('site_identity_binding_mismatch');
 exact(artifact,['image','source_commit','provenance_sha256','sbom_sha256','scan_receipt_id']);
 if(typeof artifact.image!=='string'||!/^europe-west8-docker\.pkg\.dev\/elaborate-haven-511518-a5\/[a-z][a-z0-9-]*\/[a-z0-9][a-z0-9/-]*@sha256:[a-f0-9]{64}$/.test(artifact.image))fail('regional_immutable_image_required');
 if(!/^[a-f0-9]{40}$/.test(artifact.source_commit)||![artifact.provenance_sha256,artifact.sbom_sha256].every(x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x))||!uuid(artifact.scan_receipt_id))fail('build_evidence_required');
 exact(limits,['cpu','memory_mib','max_instances','concurrency','timeout_seconds']);
 // Bounded initial static-site profile, not a commercial plan or an entitlement.
 if(limits.cpu!==1||![256,512,1024].includes(limits.memory_mib)||!Number.isInteger(limits.max_instances)||limits.max_instances<1||limits.max_instances>10||!Number.isInteger(limits.concurrency)||limits.concurrency<1||limits.concurrency>80||!Number.isInteger(limits.timeout_seconds)||limits.timeout_seconds<1||limits.timeout_seconds>300)fail('unsupported_static_site_caps');
 if(!inventory||inventory.name!==name||inventory.tenant_id!==binding.tenant_id||inventory.site_id!==binding.site_id||!uuid(inventory.receipt_id)||inventory.exists!==false)fail('existing_or_unreconciled_service_requires_review');
 if(!Number.isSafeInteger(now)||!Number.isSafeInteger(inventory.observed_at_ms)||inventory.observed_at_ms>now||now-inventory.observed_at_ms>300000)fail('fresh_inventory_required');
 const body={name,labels:{'sandy-tenant':binding.tenant_id,'sandy-site':binding.site_id},ingress:'INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER',invokerIamDisabled:false,defaultUriDisabled:true,
  scaling:{minInstanceCount:0,maxInstanceCount:limits.max_instances,scalingMode:'AUTOMATIC'},
  template:{serviceAccount:binding.service_account,scaling:{minInstanceCount:0,maxInstanceCount:limits.max_instances},timeout:limits.timeout_seconds+'s',maxInstanceRequestConcurrency:limits.concurrency,
   containers:[{image:artifact.image,ports:[{containerPort:8080}],resources:{limits:{cpu:'1',memory:limits.memory_mib+'Mi'},cpuIdle:true,startupCpuBoost:false}}]}};
 const proposal={tenant_id:binding.tenant_id,site_id:binding.site_id,source_commit:artifact.source_commit,artifact_evidence:artifact,inventory_receipt_id:inventory.receipt_id,parent:`projects/${project}/locations/${region}`,service_id:serviceId,body};
 return {...proposal,plan_sha256:digest(proposal),executable:false,cost_approval_required:true,identity_and_iam_review_required:true,public_traffic_enabled:false,remaining:['verify scan/provenance receipts and entitlement','reserve approved tenant/operator budget and quota atomically','verify existing service-account permissions and egress policy','re-read absence before one durable provider dispatch','read back revision, digest and health','separate exact approval for public routing/TLS'],rollback:'No automatic deletion. Reconcile any created service and retain data; any traffic or paid-resource lifecycle change requires its own authorized plan.'};
}

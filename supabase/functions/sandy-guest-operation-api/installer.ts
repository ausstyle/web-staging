import { WORKER_SHA256, WORKER_SOURCE } from "./worker_bundle.ts";
export { WORKER_SHA256 };
export type AgentConfig = {
  endpoint: string;
  anon_jwt: string;
  vm_name: string;
  instance_id: string;
  project_id: string;
  generation: number;
  key_id: string;
  public_key_spki_b64: string;
  platform: "linux" | "win32";
};
const base64 = (s: string) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(s)));
/** Preserve unrelated metadata and refuse to replace another startup program. */
export function installMetadata(
  instance: Record<string, unknown>,
  expectedFingerprint: string,
  config: AgentConfig,
  update: boolean,
) {
  const metadata = instance.metadata as {
    fingerprint?: string;
    items?: { key: string; value: string }[];
  } | undefined;
  if (metadata?.fingerprint !== expectedFingerprint) {
    throw Error("guest_metadata_fingerprint_changed");
  }
  if (
    config.project_id !== "elaborate-haven-511518-a5" ||
    !["sandy-video", "sandy-windows"].includes(config.vm_name) ||
    !/^https:\/\/zmqlyygzqoidkcwdysok\.supabase\.co\/functions\/v1\/sandy-guest-operation-api$/
      .test(config.endpoint) ||
    !Number.isSafeInteger(config.generation) || config.generation < 1
  ) throw Error("guest_install_configuration_invalid");
  const windows = config.platform === "win32",
    scriptKey = windows ? "windows-startup-script-ps1" : "startup-script",
    items = metadata.items ?? [];
  const existing = items.find((item) => item.key === scriptKey);
  if (
    existing && !existing.value.startsWith(
      windows
        ? "# SANDY_MANAGED_GUEST_V1"
        : "#!/bin/sh\n# SANDY_MANAGED_GUEST_V1",
    )
  ) throw Error("unrelated_startup_script_preserved");
  if (update && !existing) throw Error("guest_update_requires_managed_install");
  if (!update && existing) throw Error("guest_already_staged_use_update");
  const root = windows ? "C:\\ProgramData\\SandyGuest" : "/var/lib/sandy-guest";
  // Only public configuration is staged. The private signing key never enters VM metadata.
  const publicConfig = {
    endpoint: config.endpoint,
    anon_jwt: config.anon_jwt,
    vm_name: config.vm_name,
    instance_id: config.instance_id,
    project_id: config.project_id,
    generation: config.generation,
    key_id: config.key_id,
    public_key_spki_b64: config.public_key_spki_b64,
    file_root: windows ? root + "\\files" : root + "/files",
    journal_root: windows ? root + "\\journal" : root + "/journal",
  };
  const encodedWorker = base64(WORKER_SOURCE),
    encodedConfig = base64(JSON.stringify(publicConfig));
  let script: string;
  if (windows) {
    script = String.raw`# SANDY_MANAGED_GUEST_V1
$ErrorActionPreference='Stop'
$root='${root}'
$node='C:\Program Files\nodejs\node.exe'
if(-not (Test-Path -LiteralPath $node)){throw 'Node22PrerequisiteRequired'}
if((& $node -p 'Number(process.versions.node.split(".")[0])>=22') -ne 'true'){throw 'Node22PrerequisiteRequired'}
$systemSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$adminSid=[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')
$writeMask=[Security.AccessControl.FileSystemRights]'Write,Delete,DeleteSubdirectoriesAndFiles,ChangePermissions,TakeOwnership'
function Assert-TrustedPath([string]$p) {
 if(Test-Path -LiteralPath $p){
  $item=Get-Item -LiteralPath $p -Force
  if(($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'GuestReparsePointDenied'}
  $acl=Get-Acl -LiteralPath $p
  if($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin @($systemSid.Value,$adminSid.Value)){throw 'GuestPathOwnerUntrusted'}
  foreach($rule in $acl.Access){
   $sid=$rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
   if($sid -notin @($systemSid.Value,$adminSid.Value) -and $rule.AccessControlType -eq 'Allow' -and ($rule.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) -eq 0 -and ($rule.FileSystemRights -band $writeMask) -ne 0){throw 'GuestPathWritableByUntrustedPrincipal'}
  }
 }
}
Assert-TrustedPath $root
New-Item -Path $root -ItemType Directory -Force | Out-Null
foreach($leaf in @('worker.mjs','config.json','journal','files')){Assert-TrustedPath (Join-Path $root $leaf)}
$directoryAcl=[Security.AccessControl.DirectorySecurity]::new()
$directoryAcl.SetOwner($systemSid)
$directoryAcl.SetAccessRuleProtection($true,$false)
foreach($sid in @($systemSid,$adminSid)){$directoryAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}
Set-Acl -LiteralPath $root -AclObject $directoryAcl
$fileAcl=[Security.AccessControl.FileSecurity]::new()
$fileAcl.SetOwner($systemSid)
$fileAcl.SetAccessRuleProtection($true,$false)
foreach($sid in @($systemSid,$adminSid)){$fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,'FullControl','Allow'))}
foreach($leaf in @('worker.mjs','config.json')){if(Test-Path -LiteralPath (Join-Path $root $leaf)){Set-Acl -LiteralPath (Join-Path $root $leaf) -AclObject $fileAcl}}
$arguments='"'+(Join-Path $root 'worker.mjs')+'" "'+(Join-Path $root 'config.json')+'"'
$existingTask=Get-ScheduledTask -TaskPath '\' -ErrorAction Stop | Where-Object {$_.TaskName -eq 'SandyManagedGuestV1'}
if($existingTask){
 if(@($existingTask.Actions).Count -ne 1 -or $existingTask.Actions[0].Execute -ne $node -or $existingTask.Actions[0].Arguments -ne $arguments -or $existingTask.Principal.UserId -notin @('SYSTEM','S-1-5-18','NT AUTHORITY\SYSTEM')){throw 'UnrelatedGuestTaskPreserved'}
 # Stop the verified worker before replacing its code/config. Starting an
 # already-running task otherwise leaves its old enrollment in memory.
 Stop-ScheduledTask -TaskName 'SandyManagedGuestV1' -TaskPath '\' -ErrorAction Stop
 $deadline=(Get-Date).AddSeconds(30)
 while((Get-ScheduledTask -TaskName 'SandyManagedGuestV1' -TaskPath '\' -ErrorAction Stop).State -eq 'Running'){
  if((Get-Date) -ge $deadline){throw 'GuestTaskStopUnconfirmed'}
  Start-Sleep -Milliseconds 200
 }
}
[IO.File]::WriteAllBytes((Join-Path $root 'worker.mjs'),[Convert]::FromBase64String('${encodedWorker}'))
if((Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $root 'worker.mjs')).Hash.ToLowerInvariant() -ne '${WORKER_SHA256}'){throw 'WorkerDigestMismatch'}
[IO.File]::WriteAllBytes((Join-Path $root 'config.json'),[Convert]::FromBase64String('${encodedConfig}'))
foreach($leaf in @('worker.mjs','config.json')){Set-Acl -LiteralPath (Join-Path $root $leaf) -AclObject $fileAcl}
$action=New-ScheduledTaskAction -Execute $node -Argument $arguments
$trigger=New-ScheduledTaskTrigger -AtStartup
$settings=New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Days 3650)
Register-ScheduledTask -TaskName 'SandyManagedGuestV1' -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'SandyManagedGuestV1'
`;
  } else {
    script = String.raw`#!/bin/sh
# SANDY_MANAGED_GUEST_V1
set -eu
umask 077
node_path=$(command -v node)
[ "$("$node_path" -p 'Number(process.versions.node.split(".")[0])>=22')" = true ]
for candidate in '${root}' '${root}/worker.mjs' '${root}/config.json' '${root}/journal' '${root}/files'; do
 [ ! -L "$candidate" ] || { echo GuestSymlinkDenied >&2; exit 1; }
 if [ -e "$candidate" ]; then
  [ "$(stat -c %u "$candidate")" = 0 ] && [ "$((0$(stat -c %a "$candidate") & 0022))" -eq 0 ] || { echo GuestPathOwnerOrModeUntrusted >&2; exit 1; }
 fi
done
unit=/etc/systemd/system/sandy-managed-guest.service
[ ! -L "$unit" ] || { echo GuestUnitSymlinkDenied >&2; exit 1; }
if [ -e "$unit" ]; then [ "$(head -n 1 "$unit")" = '# SANDY_MANAGED_GUEST_V1' ] || { echo UnrelatedServicePreserved >&2; exit 1; }; fi
# enable --now does not restart an existing service. Stop only the verified
# managed unit before replacing the worker and enrollment configuration.
if [ -e "$unit" ]; then systemctl stop sandy-managed-guest.service; fi
install -d -o root -g root -m 0700 '${root}'
printf '%s' '${encodedWorker}' | base64 -d > '${root}/worker.mjs'
printf '%s  %s\n' '${WORKER_SHA256}' '${root}/worker.mjs' | sha256sum --check --status
printf '%s' '${encodedConfig}' | base64 -d > '${root}/config.json'
chmod 0600 '${root}/config.json' '${root}/worker.mjs'
cat > "$unit" <<SANDY_UNIT
# SANDY_MANAGED_GUEST_V1
[Unit]
Description=Sandy approved managed guest worker
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
User=root
ExecStart=$node_path ${root}/worker.mjs ${root}/config.json
Restart=on-failure
RestartSec=10
UMask=0077
[Install]
WantedBy=multi-user.target
SANDY_UNIT
systemctl daemon-reload
systemctl enable --now sandy-managed-guest.service
`;
  }
  return {
    fingerprint: expectedFingerprint,
    items: [...items.filter((item) => item.key !== scriptKey), {
      key: scriptKey,
      value: script,
    }],
  };
}

/** A fresh short-lived SSH identity for one approved execution; never a customer session. */
import { machineScope } from "../_shared/sandy_machine_identity.ts";
import { ephemeralSshKey, ProtocolRefusal, type SshEndpoint } from "./ssh.ts";
import { type Obj, obj, PROJECT, ZONE } from "./bindings.ts";
import type { ProviderCalls } from "./compute.ts";
const user = `users/${machineScope.service_account}`;
const root = `https://oslogin.googleapis.com/v1/users/${
  encodeURIComponent(machineScope.service_account)
}`;
const sameKey = (a: unknown, b: string) =>
  typeof a === "string" &&
  a.trim().split(/\s+/).slice(0, 2).join(" ") ===
    b.trim().split(/\s+/).slice(0, 2).join(" ");
function selectedKey(
  value: Obj,
  publicKey: string,
): { fingerprint: string; entry: Obj } | undefined {
  const profile = obj(value.loginProfile) ? value.loginProfile : value,
    keys = profile.sshPublicKeys;
  if (!obj(keys) || Object.keys(keys).length > 1000) return undefined;
  const entries = Object.entries(keys).filter(([fingerprint, entry]) =>
    /^[a-f0-9]{64}$/.test(fingerprint) && obj(entry) &&
    sameKey(entry.key, publicKey) &&
    (!entry.fingerprint || entry.fingerprint === fingerprint) &&
    (!entry.name || entry.name === `${user}/sshPublicKeys/${fingerprint}` ||
      typeof profile.name === "string" &&
        /^users\/[A-Za-z0-9_.@+-]{1,200}$/.test(profile.name) &&
        entry.name === `${profile.name}/sshPublicKeys/${fingerprint}`)
  );
  return entries.length === 1
    ? { fingerprint: entries[0][0], entry: entries[0][1] as Obj }
    : undefined;
}
function profileURL() {
  const url = new URL(root + "/loginProfile");
  url.searchParams.set("projectId", PROJECT);
  return url;
}
export async function withEphemeralOsLogin<T>(
  calls: ProviderCalls,
  address: string,
  hostKeySha256: string,
  execute: (endpoint: SshEndpoint) => Promise<T>,
  now = Date.now(),
): Promise<T> {
  const pair = ephemeralSshKey(),
    expires = String((now + 120000) * 1000),
    importURL = new URL(root + ":importSshPublicKey");
  importURL.searchParams.set("projectId", PROJECT);
  importURL.searchParams.set("regions", ZONE.slice(0, -2));
  let fingerprint: string | undefined,
    imported = false,
    unknownImport = false,
    commandAttempted = false,
    result: T | undefined,
    error: unknown,
    cleanupVerified = false;
  try {
    let value: Obj;
    try {
      value = (await calls.request(importURL, "POST", {
        key: pair.publicKey,
        expirationTimeUsec: expires,
      })).value;
      imported = true;
    } catch (e) {
      unknownImport = e instanceof ProtocolRefusal && e.mayHaveExecuted;
      throw e;
    }
    const selected = selectedKey(value, pair.publicKey);
    fingerprint = selected?.fingerprint;
    if (
      !selected || selected.entry.expirationTimeUsec !== expires ||
      !obj(value.loginProfile) ||
      !Array.isArray(value.loginProfile.posixAccounts)
    ) throw new ProtocolRefusal("oslogin_import_readback_invalid", true);
    const accounts = value.loginProfile.posixAccounts.filter((account) =>
      obj(account) && account.primary === true &&
      (!account.operatingSystemType ||
        account.operatingSystemType === "LINUX") &&
      typeof account.username === "string" &&
      /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/.test(account.username)
    );
    if (accounts.length !== 1) {
      throw new ProtocolRefusal("oslogin_unique_linux_account_required", true);
    }
    commandAttempted = true;
    result = await execute({
      address,
      port: 22,
      username: accounts[0].username as string,
      privateKey: pair.privateKey,
      hostKeySha256,
    });
  } catch (e) {
    error = e;
  } finally {
    if (imported || unknownImport) {
      try {
        if (!fingerprint) {
          fingerprint = selectedKey(
            (await calls.request(profileURL())).value,
            pair.publicKey,
          )?.fingerprint;
        }
        if (!fingerprint) {
          throw new ProtocolRefusal(
            "oslogin_identity_cleanup_unknown",
            true,
            true,
          );
        }
        await calls.request(
          new URL(`${root}/sshPublicKeys/${fingerprint}`),
          "DELETE",
          undefined,
          [404],
        );
        const readback = (await calls.request(profileURL())).value;
        if (selectedKey(readback, pair.publicKey)) {
          throw new ProtocolRefusal(
            "oslogin_identity_cleanup_unknown",
            true,
            true,
          );
        }
        cleanupVerified = true;
      } catch {
        error = new ProtocolRefusal(
          "oslogin_identity_cleanup_unknown",
          true,
          true,
        );
      }
    }
  }
  if (error) {
    if (error instanceof ProtocolRefusal) throw error;
    throw new ProtocolRefusal(
      "ssh_execution_outcome_unknown",
      commandAttempted || unknownImport && !cleanupVerified,
    );
  }
  if (!cleanupVerified) {
    throw new ProtocolRefusal("oslogin_identity_cleanup_unknown", true, true);
  }
  return result as T;
}

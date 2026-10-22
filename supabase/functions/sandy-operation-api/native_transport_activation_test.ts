import assert from "node:assert/strict";
import {
  extensionContractMatches,
  extensionContracts,
  extensionExecutionScope,
  extensionOwnsGrant,
} from "./installed_extensions.ts";
import { protocolOperations } from "../sandy-vm-protocol-api/gateway.ts";

Deno.test("native activation replaces only existing execution IDs and retains guest18 typed operations", () => {
  const names = Object.entries(extensionContracts).filter(([, c]) =>
    c.kind === "vm_protocol"
  ).map(([id]) => id).sort();
  assert.deepEqual(names, [
    "cloud.vm.exec",
    "gcp.vm.ssh.exec",
    "gcp.vm.winrm.exec",
  ]);
  for (const id of names) {
    assert.equal(extensionContracts[id].handler, "sandy-vm-protocol-api");
    assert.equal(extensionOwnsGrant(id), true);
  }
  assert.equal(
    extensionContracts["gcp.vm.files.upload"].handler,
    "sandy-guest-operation-api",
  );
  assert.equal(
    extensionContracts["gcp.vm.access.bootstrap"].handler,
    "sandy-guest-operation-api",
  );
  assert.equal(extensionContracts["cloud.vm.bindings.enroll"], undefined);
});

Deno.test("native scope requires actor-specific verified binding and rejects absent or wrong VM pins", async () => {
  const actor = "10000000-0000-4000-8000-000000000001";
  const binding = {
    "sandy-video": {
      verified: true,
      instance_id: "6831598645020395570",
      version: "10000000-0000-4000-8000-000000000002",
      ssh: { mode: "oslogin", host_key_sha256: "SHA256:" + "a".repeat(43) },
    },
  };
  const args = { vm_name: "sandy-video", command: "whoami" };
  const seen: string[] = [];
  const scope = await extensionExecutionScope(
    "gcp.vm.ssh.exec",
    args,
    actor,
    async () => null,
    {
      getProtocolBindings: async (id) => {
        seen.push(id);
        return binding;
      },
    },
  );
  assert.deepEqual(seen, [actor]);
  assert.equal(
    (scope as Record<string, unknown>).instance_id,
    "6831598645020395570",
  );
  await assert.rejects(
    () =>
      extensionExecutionScope("gcp.vm.ssh.exec", args, actor, async () => null),
    /verified_vm_protocol_binding_required/,
  );
  await assert.rejects(
    () =>
      extensionExecutionScope(
        "gcp.vm.winrm.exec",
        { vm_name: "sandy-windows", command: "whoami" },
        actor,
        async () => null,
        { getProtocolBindings: async () => binding },
      ),
    /verified_vm_protocol_binding_required/,
  );
});

Deno.test("native descriptor cannot weaken approval, session, exact schemas or key isolation", () => {
  const op = protocolOperations["gcp.vm.ssh.exec"];
  const row = {
    ...op,
    api_exposed: true,
    error_contract: {
      contract_sha256: op.contract_sha256,
      requires_approval: true,
      requires_grant: true,
      requires_real_user_session: true,
      api_key_delegable: false,
    },
  };
  assert.equal(extensionContractMatches(op.operation, row), true);
  for (
    const key of [
      "requires_approval",
      "requires_grant",
      "requires_real_user_session",
      "api_key_delegable",
    ]
  ) {
    assert.equal(
      extensionContractMatches(op.operation, {
        ...row,
        error_contract: {
          ...row.error_contract,
          [key]: !row.error_contract[key as keyof typeof row.error_contract],
        },
      }),
      false,
    );
  }
  assert.equal(
    extensionContractMatches(op.operation, {
      ...row,
      input_schema: { type: "object" },
    }),
    false,
  );
});

"""Install private contracts and replace three existing closed execution rows.

Use existing 08900 boundary first, never 08910's catalogue expansion. This does
not enroll a VM, grant authority, expose or certify any operation.
"""
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
def quote(value):
    return "'" + value.replace("'", "''") + "'"
def generate():
    contracts = json.loads((HERE / "contracts.json").read_text())
    prior = {r["operation"]: r for r in json.loads((HERE / "activation_preimage.json").read_text())}
    assert set(prior) == {"gcp.vm.ssh.exec", "gcp.vm.winrm.exec", "cloud.vm.exec"}
    sql = ["BEGIN;", "-- Existing private boundary 08900 required. No new catalogue row, exposure, enrollment or authority."]
    for op in contracts:
        record = {k: op[k] for k in ["operation", "kind", "handler", "permission_scope", "is_mutation", "input_schema", "output_schema", "contract_sha256"]}
        sql.append("INSERT INTO public.sandy_vm_protocol_contracts SELECT * FROM jsonb_populate_record(NULL::public.sandy_vm_protocol_contracts," + quote(canonical(record)) + "::jsonb);")
        if op["operation"] not in prior:
            continue
        before = prior[op["operation"]]
        keys = sorted(set(before) - {"operation"})
        guard = quote(canonical({k: before[k] for k in keys}))
        names = ",".join(quote(k) for k in keys)
        sql.append("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM public.sandy_operation_registry r WHERE operation=" + quote(op["operation"]) + " AND (SELECT jsonb_object_agg(k,to_jsonb(r)->k) FROM unnest(ARRAY[" + names + "])k)=" + guard + "::jsonb) THEN RAISE EXCEPTION 'native_activation_preimage_changed';END IF;END $$;")
        errors = {"contract_sha256": op["contract_sha256"], "requires_approval": True, "requires_grant": True, "requires_real_user_session": True, "api_key_delegable": False, "provider_effect_confirmed": False}
        values = {"handler": op["handler"], "permission_scope": op["permission_scope"], "is_mutation": op["is_mutation"], "input_schema": op["input_schema"], "output_schema": op["output_schema"], "error_contract": errors, "source_path": "supabase/functions/sandy-vm-protocol-api/index.ts", "implementation_state": "implemented_unverified"}
        def literal(value):
            return str(value).lower() if isinstance(value, bool) else quote(canonical(value)) + "::jsonb" if isinstance(value, dict) else quote(value)
        sql.append("UPDATE public.sandy_operation_registry SET " + ",".join(k + "=" + literal(v) for k,v in values.items()) + " WHERE operation=" + quote(op["operation"]) + ";")
    sql += ["-- All exposure/verification flags and last_verified_at remain at their exact closed preimages.", "COMMIT;"]
    return "\n".join(sql) + "\n"

if __name__ == "__main__":
    (ROOT / "supabase/migrations/20261022190000_sandy_native_execution_activation.sql").write_text(generate())

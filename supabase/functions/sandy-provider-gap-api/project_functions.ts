/** Missing project/function operations reuse the shared admission and receipts.
 * Management credentials never cross to a function's runtime host.
 */
import { type GapContract, type Obj, PROJECT } from "./contracts.ts";
import {
  Calls,
  type Context,
  type Dependencies,
  fail,
  list,
  nullableText,
  obj,
  redact,
  text,
} from "./runtime.ts";

const management = (suffix: string) =>
  new URL("https://api.supabase.com/v1/" + suffix);
const ref = (v: unknown) =>
  typeof v === "string" && /^[a-z]{20}$/.test(v)
    ? v
    : fail("provider_project_scope_mismatch", 502);
function project(v: unknown): Obj {
  const row = obj(v);
  return {
    ref: ref(row.ref ?? row.id),
    name: redact(text(row.name, 256), 256),
    region: text(row.region, 100),
    status: text(row.status, 100),
  };
}
export async function executeProjectFunction(
  op: GapContract,
  args: Obj,
  calls: Calls,
  deps: Dependencies,
  context: Context,
  admission: string,
  session: string | null,
): Promise<{ result: Obj; truncated: boolean }> {
  if (op.kind === "project_list") {
    const bound = obj(
      (await calls.request(management(`projects/${PROJECT}`))).body,
    );
    if ((bound.ref ?? bound.id) !== PROJECT) {
      fail("provider_project_scope_mismatch", 502);
    }
    const rows = list(
      (await calls.request(management("projects"))).body,
      10000,
    );
    const projects = rows.filter((v) => {
      const row = obj(v);
      return (row.ref ?? row.id) === PROJECT;
    }).map(project);
    if (projects.length > 1) {
      fail("provider_project_relationship_ambiguous", 502);
    }
    if (projects.length !== 1) fail("provider_project_listing_incomplete", 502);
    return {
      result: {
        projects,
        project_ref: PROJECT,
        complete_for_bound_project: true,
        other_projects_disclosed: false,
      },
      truncated: false,
    };
  }
  if (op.kind === "project_create") {
    // The caller cannot supply an organisation, database password, plan, key,
    // template URL or arbitrary provider body. Existing projects are not adopted.
    const bound = obj(
      (await calls.request(management(`projects/${PROJECT}`))).body,
    );
    if ((bound.ref ?? bound.id) !== PROJECT) {
      fail("provider_project_scope_mismatch", 502);
    }
    const slug = nullableText(bound.organization_slug);
    if (!slug || !/^[\w-]+$/.test(slug)) {
      fail("provider_project_organization_relationship_missing", 424);
    }
    const organization = obj(
      (await calls.request(management(`organizations/${slug}`))).body,
    );
    if (
      organization.slug !== slug ||
      bound.organization_id && organization.id !== bound.organization_id
    ) {
      fail("provider_project_organization_relationship_mismatch", 502);
    }
    const existing = list(
      (await calls.request(management("projects"))).body,
      10000,
    );
    if (
      existing.some((v) => {
        const row = obj(v);
        return row.name === args.name && (row.organization_slug === slug ||
          row.organization_id === organization.id);
      })
    ) {
      fail("project_name_already_exists_reconcile", 409);
    }
    if (!deps.projectCreationMaterial) {
      return fail("project_creation_custody_binding_required", 424);
    }
    let password: string;
    try {
      password = await deps.projectCreationMaterial(admission, args);
    } catch {
      fail("project_creation_custody_or_budget_refused", 403);
    }
    if (
      typeof password! !== "string" || password!.length < 16 ||
      password!.length > 256
    ) {
      fail("project_creation_custody_material_invalid", 424);
    }
    let created: Obj;
    try {
      created = obj(
        (await calls.request(management("projects"), "POST", {
          name: args.name,
          organization_slug: slug,
          region_selection: { type: "specific", code: args.region },
          db_pass: password!,
        })).body,
      );
    } finally {
      password = "";
    }
    const createdRef = ref(created!.ref ?? created!.id);
    if (
      createdRef === PROJECT || created!.name !== args.name ||
      created!.organization_slug !== slug ||
      created!.organization_id !== organization.id
    ) fail("created_project_identity_mismatch", 502);
    return {
      result: {
        accepted: true,
        effect_confirmed: false,
        project_ref: createdRef,
        name: redact(text(created!.name, 256), 256),
        status: text(created!.status, 100),
        organization_relationship_verified: true,
      },
      truncated: false,
    };
  }
  if (
    !session || !deps.functionAnonKey || !deps.validateInvocationSession ||
    !await deps.validateInvocationSession(session, context.actor_id)
  ) {
    return fail("same_authenticated_function_caller_required", 403);
  }
  const slug = String(args.slug);
  if (!/^[a-z][a-z0-9-]{2,90}$/.test(slug)) fail("invalid_function_slug", 400);
  // Never turn invocation into an anonymous or service-role execution bypass.
  const metadata = obj(
    (await calls.request(management(`projects/${PROJECT}/functions/${slug}`)))
      .body,
  );
  if (
    metadata.slug !== slug || metadata.status !== "ACTIVE" ||
    metadata.verify_jwt !== true
  ) {
    fail("installed_jwt_protected_function_required", 403);
  }
  const reply = await calls.request(
    new URL(`https://${PROJECT}.supabase.co/functions/v1/${slug}`),
    "POST",
    obj(args.body),
    { session, anonKey: deps.functionAnonKey!, requestId: context.request_id },
  );
  return {
    result: {
      accepted: true,
      effect_confirmed: false,
      function_slug: slug,
      response_sha256: reply.sha256,
      response_content_disclosed: false,
    },
    truncated: false,
  };
}

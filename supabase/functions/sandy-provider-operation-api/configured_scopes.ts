/** Additional provider scopes require an explicitly verified server configuration. */
export type BindingKind =
  | "organization"
  | "folder"
  | "destination_folder"
  | "billing_account"
  | "os_login_user";
export type ScopeBinding = {
  id: string;
  verified: true;
  project_id: "elaborate-haven-511518-a5";
};
export type VerifiedProviderBindings = Partial<
  Record<BindingKind, ScopeBinding>
>;
const patterns: Record<BindingKind, RegExp> = {
  organization: /^[0-9]{1,30}$/,
  folder: /^[0-9]{1,30}$/,
  destination_folder: /^[0-9]{1,30}$/,
  billing_account: /^[A-Fa-f0-9]{6}-[A-Fa-f0-9]{6}-[A-Fa-f0-9]{6}$/,
  os_login_user: /^[A-Za-z0-9_.@+-]{1,200}$/,
};
const prefixes: Record<BindingKind, string> = {
  organization: "organizations/",
  folder: "folders/",
  destination_folder: "folders/",
  billing_account: "billingAccounts/",
  os_login_user: "users/",
};
export function requireBinding(
  kind: BindingKind,
  bindings: VerifiedProviderBindings | undefined,
): string {
  const entry = bindings?.[kind];
  if (
    !entry || entry.verified !== true ||
    entry.project_id !== "elaborate-haven-511518-a5" ||
    typeof entry.id !== "string" || !patterns[kind]?.test(entry.id)
  ) throw new Error(`verified_${kind}_scope_binding_required`);
  return prefixes[kind] + entry.id;
}
export function parseProviderBindings(
  text: string | undefined,
): VerifiedProviderBindings | undefined {
  if (!text) return undefined;
  try {
    const value = JSON.parse(text);
    if (
      !value || typeof value !== "object" || Array.isArray(value) ||
      Object.keys(value).some((k) => !Object.hasOwn(patterns, k))
    ) return undefined;
    for (const kind of Object.keys(value)) {
      requireBinding(kind as BindingKind, value);
    }
    return value;
  } catch {
    return undefined;
  }
}
export function substituteBinding(
  value: string,
  bindings: VerifiedProviderBindings | undefined,
): string {
  return value.replace(
    /__configured_(organization|folder|destination_folder|billing_account|os_login_user)__/g,
    (_, kind) => requireBinding(kind as BindingKind, bindings),
  );
}
export function allowedConfiguredReference(
  value: string,
  bindings: VerifiedProviderBindings | undefined,
): boolean {
  const match = value.match(
    /^(organizations|folders|billingAccounts|users)\/[^/]+/,
  );
  if (!match) return true;
  return (Object.keys(patterns) as BindingKind[]).some((kind) => {
    try {
      return value === requireBinding(kind, bindings) ||
        value.startsWith(requireBinding(kind, bindings) + "/");
    } catch {
      return false;
    }
  });
}

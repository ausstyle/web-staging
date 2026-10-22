/** Reviewed aliases of the installed GitHub contracts; not an authorization
 * allowlist. Every caller still needs its exact contract and resource policy. */
export const githubMutationSemantics: Record<
  string,
  "file" | "commit" | "ref"
> = {
  "github.files.create": "file",
  "github.files.update": "file",
  "github.files.upsert": "file",
  "github.update_file": "file",
  "github.commit": "commit",
  "github.git.commits.create": "commit",
  "github.refs.create": "ref",
  "github.refs.update": "ref",
};

# Canonical constituent review: labels, milestones and tags

SANDY-ENG-0005 continuation; three families from the previously unreviewed group. The machine-readable companion records exact current source descriptors and preserved PR282 registry observations. It is not a new live provider capture or an authorization grant. PR282's independent 117/118 edits are left untouched.

- **121 labels:** eleven canonical operations include repository CRUD, issue/PR attachment/removal and milestone-label listing. Existing `issues.*` handlers are shared constituents; deleting an attachment is different from deleting the repository label.
- **122 milestones:** eight operations include CRUD, milestone-label listing and issue get/update for assignment/removal. Close/reopen is `milestones.update` with the appropriate state. Assignment is `issues.update`, not another invented milestone endpoint.
- **124 tags:** eight operations cover tag listing, immutable annotated tag create/get and shared reference list/get/create/update/delete. Creating an annotated object does not publish a tag. Lightweight tags require only the reference path. Existing engineering-branch authority cannot be treated as tag namespace permission.

Sources reviewed: [GitHub labels](https://docs.github.com/en/rest/issues/labels), [milestones](https://docs.github.com/en/rest/issues/milestones), [tag objects](https://docs.github.com/en/rest/git/tags), and [references](https://docs.github.com/en/rest/git/refs).

The prior snapshot shows repository label/milestone metadata reads exposed, but writes and shared label attachment handlers closed/restricted. Annotated tag creation is closed; tag-object retrieval is closed/restricted. Ref deletion is exposed but restricted, and branch-scoped authority does not authorize publishing/deleting tags. No denied operation was retried. Descriptor review does not settle these lifecycle effects, and none of these families is marked implementation-complete or accepted.

## Bounded next decisions

Before live lifecycle acceptance, API must implement/verify durable mutation effect readback for these exact constituents. A later Owner proposal must identify an owned synthetic issue, unique label/milestone identifiers and exact synthetic tag ref/object SHA; a short expiry; permitted create/update/attach/read/close/detach/delete effects; and compensation limited to those owned fixtures. The product's normal existing authorization/approval path must approve only those operation/target pairs. No blanket `github.*`, existing customer issue mutation, protected tag mutation or grant/exposure change is requested by this source review. Preparation can continue without that decision; live execution cannot.

Tests compare recorded method/path/provider ID/contract hashes to source, retain shared lifecycle constituents, and prevent this review from becoming an acceptance certificate. This reduces canonical ambiguity for three families but does not reduce the 161-family acceptance target.

# Registry value validation and runtime bounds

`registry_schema_validator.ts` preserves the gateway's
`createRegistrySchemaValidator().isValid(schema, value)` interface. Its
interpreted implementation returns `true` for valid data, `false` for invalid
data, and `null` when a schema is unavailable or a validation budget is
exhausted. Input validation failures reach the gateway before admission or
provider dispatch: invalid data returns HTTP 400; unavailable schemas return
HTTP 503. Output validation runs after the handler and retains the existing
failed-result semantics; it cannot establish a successful provider effect.

The implementation uses pinned `@cfworker/json-schema@4.1.1` primitive
constraints, a fixed AJV 8.17.1 Draft7 metaschema validator, and the exact
`ajv-formats@3.0.1` full format definitions. Arbitrary registry schemas are data
for that fixed metaschema validator. Their value checks are interpreted; they
are not compiled into persistent AJV generated-function scopes. Local
references, reference siblings, applicators, numeric `multipleOf`, nullable
types, and format checks preserve the reviewed AJV behavior. A reference
resolves only within the private schema snapshot; validation never fetches a
referenced URL.

The cache binds the complete canonical schema content and uses a private JSON
snapshot. A schema revision therefore invalidates the old entry even if external
contract metadata remains unchanged. The least-recently-used cache holds at most
12 entries and charges four times the UTF-8 source length against a 256 KiB
retained-source budget. This charge covers conservative key/snapshot string
storage; it is not a total-heap bound. Larger schemas can validate without being
retained. Schema canonicalization retains the existing depth-64 and 100,000-node
limits.

Each value validation allows at most 200,000 evaluation units and an evaluation
call depth of 256. A node check, a string/property regex test (including a
nonmatch), and each structural-uniqueness traversal step consume units. Regex
objects are prepared once per schema snapshot. The counter does not measure
wall-clock time, native ECMAScript RegExp execution, or every operation during
schema preparation. In particular, schema-overlap checks happen before the value
counter starts. Native RegExp execution remains synchronous and nonpreemptible,
as in the previous validator. Large or adversarial future schemas require
separate preparation/cost review.

The validator does not impose the admission canonicalizer's depth-64 bound on
otherwise permissive data. The shared admission path independently applies its
existing depth-64 and 100,000-node canonical JSON limits before its database
RPC. Focused tests prove that deeply nested permissive data is classified
consistently by both validators and is then refused by that unchanged admission
boundary.

Strict preflight rejects async schemas, unsupported keywords/formats,
unavailable references and invalid Draft7 definitions. It deliberately inspects
async or unknown branches after an always-valid `anyOf` branch, which the pinned
AJV optimizer can skip. These definitions return `null`; the measured installed
catalogue has no such unavailable schemas. The pinned AJV handling of
`__proto__` schema-map entries and its harmless legacy annotation names is
explicitly covered by compatibility tests.

Differential tests import the verbatim pre-promotion bounded AJV implementation
from the test-only `registry_schema_ajv_reference_test_support.ts` module. Its
SHA-256 is `650b512c69590fac1e7cc9c369bee4a65988ffc5cfaa64ed054a97d349f6cb18`.
It is not imported by production code. The two historical prototype files retain
their original bytes; current differential evidence comes from the neutral
interpreter tests and that independent AJV reference.

Promotion memory comparisons use identical pinned application graphs with either
this engine or the verbatim bounded AJV reference. They measure each exact Deno
child with `os.wait4`, separately from the parent's cumulative child-process
statistics. The current source catalogue and its actual registry schemas are
streamed per operation; additional controlled exercises keep the fixture
resident or send sequential maximum-size payloads. Counts, exit statuses,
RSS/heap peaks and exact graph hashes are retained in the release evidence.
These are local source fixtures with no provider/database execution or
deployment proof.

Earlier artifacts used `getrusage(RUSAGE_CHILDREN)` and reported values
including 295,067,648 bytes for a retained-catalogue/maximum-payload stress
fixture. That aggregate can include previously reaped comparison or test
processes when the shell executes the final measurement runner. Such values
remain conservative, unreliable process-history bounds; they are not established
Deno-child peaks. The corrected runner includes an isolation check proving that
a preceding larger process does not inflate the measured Deno child's RSS.
Earlier figures do not retrospectively establish either a Deno capacity failure
or production margin.

A passing local sequential workload does not establish margin for broad future
catalogue activation, concurrent discovery and execution, or several
maximum-size requests. Activation and load decisions require fresh measurements
of the actual exposed catalogue and request mix. Local validation tests never
mark a provider operation verified.

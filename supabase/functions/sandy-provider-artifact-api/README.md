# Owner-approved provider artifact delivery

`provider.artifacts.read_private` returns at most1MiB of exact captured download
bytes as typed base64. It requires a fresh normal-owner session, explicit approval
bound to the artifact ID and expected digest, and one consumed admission. Customer
keys and tenant sessions cannot execute it. The operation is closed and unverified.

Exactly six source operations qualify: the five fixed-repository GitHub Actions
artifact/log download adapters and the fixed-project Artifact Registry file
download adapter. Function source, all08500 sensitive captures, KMS material,
identity/token captures, credential custody, cursors and redirect locations are
excluded. The source class is the immutable recorded operation, not caller metadata.
The original fixed provider URL is rechecked against the matching operation route;
no arbitrary or signed URL can select material for delivery.

The private SQL function checks the current approved delivery contract, actor,
input and scope hashes, source actor, succeeded source admission, compiled source
contract and current registry revision, artifact TTL, all expected source digests,
and one-use state. It locks the artifact, decrypts only its recorded private Vault
reference, verifies canonical base64, byte length and SHA256, and marks it consumed
in the same transaction. Only service_role can call that function; underlying
private-table and Vault access remains unavailable to customer sessions.

Known private-key, credential JSON, provider token and JWT markers are also refused.
This is defense in depth. The exact source class authorizes provider-download
content; the implementation cannot prove arbitrary archive members contain no
unrecognized secret. It never treats sensitive custody as a downloadable artifact.

The backend verifies the returned bytes and all source bindings again, validates
the closed output schema and writes the shared execution receipt before returning
content. Transactional SQL refusal returns `executed:false`; ambiguous delivery or
receipt failure returns `executed:null,reconciliation_required:true` without bytes.
There is no automatic retry or recovery of a consumed payload. The existing TTL
cleanup removes consumed encrypted material. No provider credential is acquired,
no provider request is made, and no general Vault read endpoint is introduced.

08800 also fixes an existing SQL capture defect: separate clock reads for the
default creation time and ten-minute expiry could violate the strict TTL CHECK by
one microsecond. It first checks the exact current save-function source hash, then
uses one server timestamp for both explicit values. All existing authorization,
URL, quota, hashing and Vault checks remain. Native PostgreSQL tests assert the
exact ten-minute bound and successful save/readback for all six delivery classes.

The Deno tests use synthetic policy and custody callbacks. Administrative native
PostgreSQL/Vault fixtures create only dummy material and end with fullROLLBACK.
These do not verify a Controller session, real approval, provider download or live
Edge runtime. Larger transfers, function-source delivery and other private capture
classes remain separate work and are not counted as complete by this operation.

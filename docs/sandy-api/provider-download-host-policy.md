# Private GitHub Actions download transport

GitHub documents `results-receiver.actions.githubusercontent.com` and
`*.blob.core.windows.net` as endpoints for uploading and downloading job summaries,
logs, workflow artifacts and caches. The authoritative documentation is the
[GitHub runner communication reusable](https://raw.githubusercontent.com/github/docs/main/data/reusables/actions/runner-essential-communications.md),
retrieved21 October2026. Its exact source snapshot is committed as
[github-runner-essential-communications.md](provider-sources/github-runner-essential-communications.md),
SHA256 `0122590a135e29ae6aae87fe2aaa46504516896237a360844c21c6a3ea9accfd`.
The upstream main URL is mutable; the checked-in bytes and hash pin the reviewed
policy. The raw documentation host was accessible from the execution machine;
the GitHub API and rendered documentation host were blocked by its configured
proxy during this check. This does not establish Edge egress availability.

The implementation narrows that policy to the exact results receiver or a single
Azure storage account DNS label of3–24 lowercase letters/digits followed by
`.blob.core.windows.net`. It accepts an HTTPS URL only from a302 response to one
of the five compiled Actions artifact/log routes in `ausstyle/web-staging`.
Caller URLs, ports, user information, fragments, IP addresses, nested host labels,
suffix lookalikes, control characters and undocumented hosts are refused.

Only one second-hop GET is performed, without Authorization, cookies, request body
or referrer. Redirect handling is manual; any second redirect, partial response or
non200 status fails closed. API and storage responses each have a30-second limit,
with at most60 seconds for the two requests. The complete decoded payload is
limited to1MiB; stream errors, oversized content and mismatched uncompressed
Content-Length are refused. There is no automatic retry of an expired URL.

Downloaded bytes are SHA256 hashed and then captured in existing private encrypted
custody. The custody binding retains the immutable fixed GitHub API resource,
actor, operation, admission, arguments and scope digest. The signed storage URL
is absent from internal receipts, operation outputs and errors. The operation
returns only the existing opaque artifact receipt with byte length, digest,
media type and expiry. This completes a bounded transfer into private custody;
there is no public payload retrieval or unrestricted large-file delivery.

Local provider, policy and custody fixtures establish source behavior only.
The operations stay closed and unverified pending an exact approved owner session,
authorized Actions fixture, provider permissions and deployed runtime egress.
No actual private Actions download or provider mutation is performed by these tests.

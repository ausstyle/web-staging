# Sandy Engineering MCP (staged source)

This isolated MCP HTTP service exposes only existing Sandy engineering backend operations.

## Tools
- `sandy_model_route_readiness` — read routing diagnostics and delegation policy.
- `sandy_run_model_canary` — invoke a predefined model test; requires a valid Engineering Control change ID.
- `sandy_engineering_change_details` — inspect change evidence and status.

## Security
Clients supply a Sandy Supabase user access token in the `Authorization: Bearer <token>` header. The service forwards that bearer token directly to Sandy's existing backend, where user identity and Sandy Controller administrator membership are independently verified. Do not send Supabase service-role keys from clients. No tokens are persisted or logged by this process. All endpoints are read-only except the bounded test-canary operation, which has a recorded provider cost but does not modify routing or send communications.

## Deployment
From this directory: `npm ci` (after generating and committing a lockfile), `npm run check`, then `npm start`. Expose HTTPS `POST /mcp` behind a trusted reverse proxy with TLS, rate limits and origin policy. `GET /healthz` is a public liveness endpoint. Configure `SANDY_SUPABASE_PROJECT_REF` and `PORT`. Do not assume a GitHub commit deploys an MCP service.

This is a proposed new service, not a replacement for the currently connected Sandy Operations V2 server. Release only after dependency installation, authentication negative tests, backend smoke tests, and MCP client discovery checks pass. Configure the new HTTPS URL and authenticated connection in ChatGPT after deployment.

## Known constraints
The existing model canary performs limited deterministic content checks. It does not establish full model quality or eligibility for production routing changes. Google Cloud IAM repair and backup/restore verification are separate, still-unimplemented workstreams.

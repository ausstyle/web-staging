# Sandy Rooms: Gemini Live Avatar deployment

Target: existing `sandy-video` Google Cloud VM in project `elaborate-haven-511518-a5`, zone `europe-west1-b`.

Use Gemini `gemini-3.8-live` in the EU multi-region. It supports `generation_config.response_modalities=["VIDEO"]` for synchronized speech and avatar frames. See https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/live-api/configure-live-avatars.

Before enabling this in production: verify the workload identity token exchange and Google Cloud IAM impersonation, enable Vertex AI API with an authorized administrator, confirm model access and quota, deploy a persistent bidirectional WebSocket media bridge on the existing video VM, publish the rendered AI participant into Sandy Rooms, and validate an actual two-human-plus-Sandy call with audio, video, interruption, transcript permission and disconnection tests.

Keep existing OpenAI audio bridge intact until acceptance passes. Do not expose Google Cloud credentials to browser clients. Avoid claiming production readiness from database-only configuration or VM RUNNING state.

Current blocker: Sandy Operations MCP returns internal errors for both registry and VM status. Connected Supabase shows a historical Google Cloud job reporting `sandy-video` RUNNING on October 20, but this is not live verification. An October 20 worker installation job remained pending approval. No Gemini service configuration or deployed media bridge has been verified.

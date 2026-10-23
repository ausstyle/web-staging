# Sandy marketing — Cloud Run deployment

**Source-only setup; no live deployment or DNS cutover confirmed.**
Project: `elaborate-haven-511518-a5`
Service: `sandy-marketing`
Region: `europe-west1` (configurable)
Public website source: `sandy/index.html` only.

## Prerequisites

An authorized administrator with Google Cloud token and outbound API access must:
1. Enable `run.googleapis.com`, `cloudbuild.googleapis.com`,
   `artifactregistry.googleapis.com` and requisite Cloud Build permissions.
2. Ensure Cloud Build, Artifact Registry and Cloud Run service identities have
   least-privilege permissions. Do not create or commit long-lived JSON keys.
3. Select a verified artifact repository named `sandy-web` and create it if missing.
4. Use an authorized identity to execute from the `sandy/` directory:

```bash
PROJECT=elaborate-haven-511518-a5
REGION=europe-west1
IMAGE="$REGION-docker.pkg.dev/$PROJECT/sandy-web/sandy-marketing:$(git rev-parse --short HEAD)"
gcloud builds submit . --project "$PROJECT" --config cloudbuild.yaml --substitutions "_IMAGE=$IMAGE"
gcloud run deploy sandy-marketing --project "$PROJECT" --region "$REGION" \
  --image "$IMAGE" --port 8080 --allow-unauthenticated \
  --min-instances 0 --max-instances 3 --cpu 1 --memory 256Mi
```

For the custom domain, use Google Cloud external Application Load Balancer
with a serverless NEG, managed certificate, and Cloud DNS or registrar records
returned **after** resource creation. Cloud Run direct domain mapping is not
recommended for a production multi-region-ready architecture. Do not repoint
`sandy.chat` until a verified HTTPS endpoint is ready.

## Rollback
Redeploy the prior Cloud Run revision or restore traffic using
`gcloud run services update-traffic sandy-marketing --to-revisions <REVISION>=100`.
Keep the existing GitHub Pages site active until verified cutover.

## Security
No build includes `sandy/app`, secrets or internal controls. Container must
respond on port 8080. Only this public marketing service may permit anonymous
invocation. Deploy via approved Sandy API release identity and policy.

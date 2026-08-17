# Hosting the overlay tiles (Cloudflare R2)

The European runnable overlay is the whole pedestrian network — ~94 million
features / ~6.8 GB of geometry. Kept complete (no density dropping), the
PMTiles file is a few GB, which **exceeds GitHub's 2 GB release-asset limit**.
PMTiles is designed to be served straight from object storage over HTTP range
requests, so we host the file on **Cloudflare R2** (free tier: 10 GB storage,
no egress fees). The site stays 100% static — R2 is just storage, no server.

A hard size guard in the build (`R2_MAX_BYTES`, default 9 GB) aborts the upload
if the file would ever approach the free-tier limit.

## One-time setup

1. **Create a Cloudflare account** (free) and an **R2 bucket**, e.g. `my-map-run`.
2. **Enable public access** for the bucket:
   - R2 → your bucket → *Settings* → *Public access* → enable the **r2.dev**
     subdomain. You get a base URL like `https://pub-XXXXXXXX.r2.dev`.
   - (Optional, better for production: connect a custom domain via Cloudflare.)
3. **Set the bucket CORS policy** (R2 → bucket → *Settings* → *CORS policy*):
   ```json
   [
     {
       "AllowedOrigins": ["https://misht-world.github.io"],
       "AllowedMethods": ["GET", "HEAD"],
       "AllowedHeaders": ["range", "if-match"],
       "ExposeHeaders": ["content-range", "content-length", "accept-ranges", "etag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   (Add `http://localhost:5173` to `AllowedOrigins` if you want to test the R2
   tiles from the local dev server.)
4. **Create an R2 API token** (R2 → *Manage R2 API Tokens* → *Create*) with
   **Object Read & Write** permission on the bucket. Note the **Access Key ID**,
   **Secret Access Key**, and your **Account ID**.
5. **Add GitHub repository secrets** (Settings → Secrets and variables → Actions):
   | Secret | Value |
   |---|---|
   | `R2_ACCOUNT_ID` | Cloudflare account ID |
   | `R2_ACCESS_KEY_ID` | R2 token access key ID |
   | `R2_SECRET_ACCESS_KEY` | R2 token secret |
   | `R2_BUCKET` | bucket name, e.g. `my-map-run` |
   | `R2_PUBLIC_BASE` | public base URL, e.g. `https://pub-XXXXXXXX.r2.dev` |

   Optionally set repository **variable** `R2_MAX_BYTES` to change the size cap.

## After setup

- **Actions → Build data tiles → Run workflow** rebuilds the tileset, guards
  its size, uploads `europe-run.pmtiles` to R2, and publishes only the tiny
  `europe-extent.geojson` to a GitHub Release (date marker + coverage outline).
- The **Deploy site** workflow bakes `VITE_PMTILES_URL = <R2_PUBLIC_BASE>/europe-run.pmtiles`
  into the site. The browser loads tiles from R2 by range request.

## Verifying

```bash
# File present + range support:
curl -sI "$R2_PUBLIC_BASE/europe-run.pmtiles" | grep -iE 'content-length|accept-ranges'
```
Then open the site and confirm (browser devtools): requests to the R2 URL
return **206 Partial Content**, there are **no CORS errors**, and the pedestrian
network is dense at city zoom.

## Cost / limits

R2 free tier: 10 GB storage, 10M Class-B (read) ops/month, **no egress fees**.
A multi-GB tileset and personal browsing stay comfortably within it. If storage
ever gets tight, lower `--maximum-zoom` in the tile build (`.github/workflows/data.yml`)
or raise the per-feature `tileMinZoom` thresholds in
`packages/tile-builder/src/normalize.ts`.

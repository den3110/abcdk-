# R2 Gateway Worker

Cloudflare Worker gateway for a sharded R2 setup where each `r2-XX` target points to a different public upstream URL.

This worker lets the app use stable public base URLs such as:

- `https://cdn.example.com/r2-01`
- `https://cdn.example.com/r2-02`

The backend will append the object key after that base URL, for example:

- `https://cdn.example.com/r2-01/recordings/v2/matches/<matchId>/<recordingId>/live-manifest.json`

## Recommended URL shape

Use a dedicated gateway hostname:

- `https://cdn.yourdomain.com/r2-01`

This is simpler than sharing the main site hostname. If you must use a path on the main hostname, set `PATH_PREFIX` to `/cdn` and route `yourdomain.com/cdn/*` to the Worker.

## Files

- `src/index.js`: Worker proxy code.
- `wrangler.jsonc`: Worker configuration and placeholder target URLs.
- `package.json`: local scripts for Wrangler.

## Configure target URLs

Edit [wrangler.jsonc](./wrangler.jsonc) and replace the placeholder `TARGET_R2_XX_URL` values with your real upstream URLs.

Example:

```json
"vars": {
  "PATH_PREFIX": "",
  "CACHE_TTL_SECONDS": "0",
  "ALLOWED_ORIGINS_JSON": "[\"https://pickletour.vn\",\"https://admin.pickletour.vn\"]",
  "TARGET_R2_01_URL": "https://pub-real-01.r2.dev",
  "TARGET_R2_02_URL": "https://pub-real-02.r2.dev"
}
```

## Path prefix option

Choose one of these two deployment styles:

### Style A: dedicated hostname

- Public URL: `https://cdn.yourdomain.com/r2-01/...`
- `PATH_PREFIX = ""`
- Worker custom domain: `cdn.yourdomain.com`

### Style B: main hostname path

- Public URL: `https://yourdomain.com/cdn/r2-01/...`
- `PATH_PREFIX = "/cdn"`
- Worker route: `yourdomain.com/cdn/*`

## Deploy with Wrangler

From this directory:

```powershell
npm install
npx wrangler login
npx wrangler deploy
```

Cloudflare recommends using Wrangler locally in the project. The current docs show `npx wrangler <command>` as the standard flow.

## Connect the Worker to your domain

### If you use a dedicated hostname

After deploy, go to the Worker in Cloudflare and add a custom domain:

- `cdn.yourdomain.com`

### If you use the main hostname path

After deploy, add a route:

- `yourdomain.com/cdn/*`

## Test before wiring the app

Use a small test object like:

- object key: `recordings/v2/ping.txt`

Then open:

- `https://cdn.yourdomain.com/r2-01/recordings/v2/ping.txt`

If that works, the corresponding app setting is:

- target `r2-01` -> `publicBaseUrl = https://cdn.yourdomain.com/r2-01`

## App mapping

For each storage target in the admin page:

- `r2-01` -> `https://cdn.yourdomain.com/r2-01`
- `r2-02` -> `https://cdn.yourdomain.com/r2-02`
- ...

Do not put the object key into `publicBaseUrl`. Put only the stable prefix.

## Health endpoint

The Worker exposes:

- `/healthz`

Examples:

- `https://cdn.yourdomain.com/healthz`
- `https://yourdomain.com/cdn/healthz` if `PATH_PREFIX` is `/cdn`

## Production caveat

This gateway makes the app-side URL structure stable, but if your upstreams are still `r2.dev`, you still inherit the limitations of `r2.dev`.

This is acceptable for a low-cost workaround, but it is not equivalent to each bucket having a first-class custom domain.

## Sources

- https://developers.cloudflare.com/r2/data-access/public-buckets/
- https://developers.cloudflare.com/workers/configuration/routing/
- https://developers.cloudflare.com/workers/wrangler/commands/

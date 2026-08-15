# Ava LiveKit Web Embed

This self-contained Next.js application is the inline voice UI for the Best Driving School static website. It is based on LiveKit's official [`agent-starter-embed`](https://github.com/livekit-examples/agent-starter-embed) at commit `ded6e3fed04da81bd11014a80d407b1c382c66cd` (May 12, 2026).

The supported iframe route is `/embed`. The root route redirects there. The app uses LiveKit's current `Session` and endpoint `TokenSource` APIs and dispatches only the production `livekit-agent` deployment.

## Environment

Copy `.env.example` to `.env.local` and set these server-side values:

```text
LIVEKIT_URL
LIVEKIT_API_KEY
LIVEKIT_API_SECRET
```

`LIVEKIT_API_SECRET` is read only by the server route at `/api/connection-details`. Do not prefix it with `NEXT_PUBLIC_`.

## Local development

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

Open `http://localhost:3000/embed`. The static site's `src/config.js` points to this URL for local development.

## Validation

```bash
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm build
```

## Production container

Build from this directory and expose port `3000`:

```bash
docker build -t bds-livekit-web-embed .
docker run --rm -p 3000:3000 \
  -e LIVEKIT_URL \
  -e LIVEKIT_API_KEY \
  -e LIVEKIT_API_SECRET \
  bds-livekit-web-embed
```

After Dokploy assigns an HTTPS domain, set `src/config.js` in the static site to:

```js
avaEmbedUrl: "https://YOUR-DOKPLOY-DOMAIN/embed"
```

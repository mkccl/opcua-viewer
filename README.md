# OPC UA Client

A small read-only OPC UA viewer. Browsers cannot speak `opc.tcp`, so this Next.js app holds the session on the server. The page browses the address space, reads node attributes, and streams monitored values over server-sent events.

## Run locally

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000.

The connect form starts filled in for `opc.tcp://opc-sim.ccl-dev.com:4840`, security mode None, policy None, anonymous login. Change the fields to use another server.

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm start
```

## Docker

```bash
docker build -t opcua-viewer .
docker run --rm -p 3000:3000 opcua-viewer
```

The container has to be able to reach the OPC UA server. Nothing in this repo deploys it.

## Desktop

Electron packages this same app. The main process starts the Next.js standalone server (the `server.js` the Docker image runs) and opens a window to `http://127.0.0.1`. The page, route handlers, and OPC UA session stay in that server, so the web and desktop builds share one codebase.

```bash
pnpm desktop
pnpm desktop:pack
```

`pnpm desktop:pack` writes installers to `release/`. On Linux that is an AppImage. Windows (nsis) and macOS (dmg) are configured in `electron-builder.yml`. The Desktop installers workflow builds all three when a `v*` tag is pushed or when the workflow is run by hand. It uploads artifacts and does not publish a release.

Saved connection profiles are stored in the app user-data directory. A profile keeps the endpoint, security mode, security policy, authentication type, and username. Passwords are not stored.

## Limits

- Read only. The server never writes a value and never calls a method.
- Sessions stay in the memory of one Node process, keyed by an httpOnly cookie. A restart or a second copy of the app does not share them. Disconnect closes the OPC UA session, subscription, and monitored items. Idle sessions are closed after 8 hours.
- Sign and SignAndEncrypt use a client certificate that `node-opcua` creates on first connect. The OPC UA server has to trust that certificate. This app trusts the server certificate automatically. There is no certificate screen.
- Live values use an OPC UA subscription and server-sent events.
- The app has no login of its own. Do not put it on the public internet: anyone who can open it can ask it to connect to OPC UA servers the process can reach.
- Quitting the desktop app drops the in-memory OPC UA session. Saved profiles remain on disk, without passwords.

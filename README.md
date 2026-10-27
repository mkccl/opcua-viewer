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

## Limits

- Read only. The server never writes a value and never calls a method.
- Sessions stay in the memory of one Node process, keyed by an httpOnly cookie. A restart or a second copy of the app does not share them. Disconnect closes the OPC UA session, subscription, and monitored items. Idle sessions are closed after 8 hours.
- Sign and SignAndEncrypt use a client certificate that `node-opcua` creates on first connect. The OPC UA server has to trust that certificate. This app trusts the server certificate automatically. There is no certificate screen.
- Live values use an OPC UA subscription and server-sent events.
- The app has no login of its own. Do not put it on the public internet: anyone who can open it can ask it to connect to OPC UA servers the process can reach.

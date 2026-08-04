# WhatsApp Sender

Local WhatsApp sending dashboard built with Node.js, Express, Socket.IO and `whatsapp-web.js`.

## Local setup

1. Install Node.js LTS and Google Chrome.
2. Copy `config.example.json` to `config.json`.
3. Run `npm ci`.
4. Run `npm start` or double-click `启动Mac.command` on macOS.
5. Open <http://localhost:3000>.

## Data and credentials

WhatsApp sessions, contact/group caches, uploaded media, API keys and runtime logs are deliberately excluded from Git. Never commit `.wwebjs_auth`, `config.json`, `groups_cache.json`, `uploads` or log files.

## Deployment note

The complete Sender backend is designed to run as a persistent local service because it owns a long-lived WhatsApp Web/Chrome session and writes session data to disk. Vercel Functions are invocation-based and have an ephemeral writable filesystem, so the backend cannot be deployed there unchanged.

A Vercel deployment should use a hybrid architecture: host the web interface on Vercel while keeping the authenticated Sender agent on a persistent machine/server, connected through a secured API. Do not deploy the current backend as a public, unauthenticated endpoint.

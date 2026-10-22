# Random URL Proxy

A small Node.js/Express prototype that assigns random URL paths to browsing requests and rewrites common HTML links/resources through the proxy.

## Run locally

Requires Node.js 20 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000.

## Deploy on Render

1. Create a GitHub repository and upload these files.
2. Sign in to Render and choose **New + → Blueprint**.
3. Connect the repository containing `render.yaml`.
4. Confirm the service settings and deploy.
5. Render will provide a public URL such as `https://random-url-proxy.onrender.com`.

If you deploy without using the Blueprint, create a **Web Service** with:
- Build command: `npm install`
- Start command: `npm start`
- Node version: 20 or newer

## Important limitations and security

- This is a learning/demo proxy, not a production-grade proxy.
- Random paths are not authentication, encryption, or anonymity.
- It intentionally blocks private/reserved IPs and local hostnames to reduce SSRF risk, but this prototype has not been security-audited.
- A basic HTML rewrite will not support every site. JavaScript-heavy apps, complex forms, login sessions, WebSockets, streaming, CSP, service workers, and many modern sites may break.
- Do not use this to bypass access controls, school/work policies, paywalls, or site restrictions. Do not enter passwords or sensitive data.
- Public deployments can be abused as open proxies. Before sharing widely, add authentication, request/rate limits, logging/abuse handling, and stronger DNS/IP validation at connection time. Consider restricting the allowed destination domains.
- Render free instances may sleep when idle and can have usage limits.

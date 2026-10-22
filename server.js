import express from "express";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { URL } from "node:url";
import * as cheerio from "cheerio";

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || "";
const MAX_BYTES = 3 * 1024 * 1024;
const TIMEOUT_MS = 12000;

app.disable("x-powered-by");
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

function randomSlug() {
  return crypto.randomBytes(9).toString("base64url");
}
function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}
function isPrivateIPv4(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 0 || p[0] === 10 || p[0] === 127 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && p[1] === 168) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    p[0] >= 224;
}
function isPrivateIPv6(ip) {
  const x = ip.toLowerCase();
  return x === "::" || x === "::1" || x.startsWith("fc") || x.startsWith("fd") ||
    /^fe[89ab]/.test(x) || x.startsWith("::ffff:127.") || x.startsWith("::ffff:10.") ||
    x.startsWith("::ffff:192.168.");
}
async function validatePublicUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { throw new Error("Enter a valid URL."); }
  if (!["http:", "https:"].includes(u.protocol)) throw new Error("Only HTTP and HTTPS URLs are supported.");
  if (u.username || u.password) throw new Error("URLs containing usernames or passwords are not allowed.");
  const hostname = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Local addresses are blocked.");
  }
  const ipType = net.isIP(hostname);
  if (ipType === 4 && isPrivateIPv4(hostname)) throw new Error("Private or reserved IP addresses are blocked.");
  if (ipType === 6 && isPrivateIPv6(hostname)) throw new Error("Private or reserved IP addresses are blocked.");
  if (!ipType) {
    let records;
    try { records = await dns.lookup(hostname, { all: true, verbatim: true }); }
    catch { throw new Error("Could not resolve that host."); }
    if (!records.length || records.some(r => r.family === 4 ? isPrivateIPv4(r.address) : isPrivateIPv6(r.address))) {
      throw new Error("Hosts resolving to private or reserved IP addresses are blocked.");
    }
  }
  return u;
}
function proxyPath(slug, target) {
  return `/p/${encodeURIComponent(slug)}?url=${encodeURIComponent(target)}`;
}
function homePage(message = "") {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Random URL Proxy</title><style>
*{box-sizing:border-box}body{font:16px system-ui,sans-serif;background:#101827;color:#eef2ff;margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}
main{max-width:680px;width:100%;background:#1b2638;border:1px solid #34435b;border-radius:20px;padding:28px}
h1{margin-top:0;font-size:clamp(28px,5vw,40px)}p{color:#bdc8da;line-height:1.55}
form{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0}input{flex:1;min-width:220px;padding:14px;border-radius:10px;border:1px solid #50617a;background:#0d1420;color:white;font-size:16px}
button{padding:14px 18px;border:0;border-radius:10px;background:#a5f3fc;color:#10202c;font-weight:700;cursor:pointer}
.note{font-size:13px;color:#9caec6}.error{color:#fecaca;background:#4a2028;padding:10px;border-radius:8px}
</style></head><body><main><h1>Random URL Proxy</h1>
<p>Enter a public website. The proxy will open it through a fresh random path on this server.</p>
${message ? `<p class="error">${escapeHtml(message)}</p>` : ""}
<form method="post" action="/open"><input name="url" type="text" required placeholder="https://example.com" autocomplete="url"><button type="submit">Open website</button></form>
<p class="note">Prototype: some sites may not work correctly. Do not enter passwords or sensitive information. This service is not anonymous and does not bypass website access controls.</p>
</main></body></html>`;
}
app.get("/", (_req, res) => res.type("html").send(homePage()));
app.post("/open", async (req, res) => {
  try {
    let raw = String(req.body.url || "").trim();
    if (!raw) return res.status(400).type("html").send(homePage("Enter a website URL."));
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    const url = await validatePublicUrl(raw);
    res.redirect(302, proxyPath(randomSlug(), url.href));
  } catch (e) {
    res.status(400).type("html").send(homePage(e.message || "Could not open that URL."));
  }
});
app.get("/p/:slug", async (req, res) => {
  try {
    const target = await validatePublicUrl(String(req.query.url || ""));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let upstream;
    try {
      upstream = await fetch(target.href, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "RandomURLProxy/1.0 (basic web proxy)",
          "accept": req.headers.accept || "text/html,*/*;q=0.8"
        }
      });
    } finally { clearTimeout(timeout); }

    if ([301,302,303,307,308].includes(upstream.status)) {
      const location = upstream.headers.get("location");
      if (!location) return res.status(502).send("Upstream redirect had no location.");
      const next = new URL(location, target);
      await validatePublicUrl(next.href);
      return res.redirect(302, proxyPath(randomSlug(), next.href));
    }

    const type = upstream.headers.get("content-type") || "application/octet-stream";
    res.status(upstream.status);
    res.set("content-type", type);
    res.set("cache-control", "no-store");
    res.set("x-content-type-options", "nosniff");

    if (!type.toLowerCase().includes("text/html")) {
      const data = Buffer.from(await upstream.arrayBuffer());
      if (data.length > MAX_BYTES) return res.status(413).send("Response too large for this demo proxy.");
      return res.send(data);
    }

    const html = await upstream.text();
    if (Buffer.byteLength(html, "utf8") > MAX_BYTES) return res.status(413).send("Page too large for this demo proxy.");
    const $ = cheerio.load(html);
    const currentSlug = req.params.slug;
    const rewrite = (raw, attr) => {
      if (!raw || raw.startsWith("#") || /^(data:|javascript:|mailto:|tel:|blob:)/i.test(raw.trim())) return raw;
      try {
        const absolute = new URL(raw, target);
        if (!["http:", "https:"].includes(absolute.protocol)) return raw;
        return proxyPath(randomSlug(), absolute.href);
      } catch { return raw; }
    };
    $("a[href]").each((_, el) => $(el).attr("href", rewrite($(el).attr("href"), "href")));
    $("form[action]").each((_, el) => {
      const action = rewrite($(el).attr("action"), "action");
      $(el).attr("action", action);
      $(el).attr("method", "get");
    });
    // Rewrite common resource URLs. This basic approach does not cover every JS-created URL.
    $("[src]").each((_, el) => $(el).attr("src", rewrite($(el).attr("src"), "src")));
    $("[poster]").each((_, el) => $(el).attr("poster", rewrite($(el).attr("poster"), "poster")));
    $("head").prepend(`<base href="${escapeHtml(target.origin + "/")}">`);
    $("body").prepend(`<div style="font:12px system-ui;background:#fff3cd;color:#332b00;padding:7px;text-align:center">Random URL Proxy · destination: ${escapeHtml(target.hostname)} · <a href="/">Open another site</a></div>`);
    res.send($.html());
  } catch (e) {
    res.status(400).type("text").send(`Proxy error: ${e.message || "Unable to fetch website."}`);
  }
});
app.get("/health", (_req, res) => res.json({ ok: true }));
app.listen(PORT, "0.0.0.0", () => console.log(`Random URL Proxy listening on ${PORT}`));

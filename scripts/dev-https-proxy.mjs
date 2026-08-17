#!/usr/bin/env node
/**
 * LOCAL-DEVELOPMENT-ONLY TLS-terminating proxy.
 *
 * Why this exists: browser wallet extensions refuse to inject their
 * provider on plain-http origins other than localhost/127.0.0.1 — Phantom
 * documents this explicitly (docs.phantom.com FAQ). A dev box reached over
 * the network as http://<ip>:3000 therefore can never see Phantom, no
 * matter what the app does. This proxy puts a self-signed https origin in
 * front of the EXISTING dev servers so a real extension can be tested,
 * without weakening any app security: nothing about CSP, validation, or
 * the backend changes — traffic is simply carried over TLS.
 *
 * It serves two listeners:
 *   https://<host>:3443  ->  http://127.0.0.1:3000   (the Next.js dev UI)
 *   https://<host>:8443  ->  http://127.0.0.1:8899   (solana-test-validator
 *      RPC — an https page cannot fetch an http RPC; that would be blocked
 *      as mixed content, so the RPC needs an https origin too)
 * WebSocket upgrades (Next HMR, RPC pubsub) are piped through raw.
 *
 * Certificate: self-signed, generated on first run into
 * ~/glc-local-backend/tls/ (outside the repository — never committed).
 * Browsers will warn once per origin; accepting the warning still yields a
 * genuine https origin, which is all extension injection policies check.
 *
 * NOT a production mechanism. Production terminates TLS at a real reverse
 * proxy with a real certificate (see .env.example's BRIDGE_API_URL note).
 *
 * Usage:  node scripts/dev-https-proxy.mjs
 * Env:    UI_TARGET / RPC_TARGET / UI_TLS_PORT / RPC_TLS_PORT to override.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:https";
import { request as httpRequest } from "node:http";
import { connect as tcpConnect } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const TLS_DIR = join(homedir(), "glc-local-backend", "tls");
const KEY = join(TLS_DIR, "dev-key.pem");
const CERT = join(TLS_DIR, "dev-cert.pem");

if (!existsSync(KEY) || !existsSync(CERT)) {
  mkdirSync(TLS_DIR, { recursive: true });
  // Self-signed, 30-day, SAN covering any host this box is reached as.
  execFileSync("openssl", [
    "req",
    "-x509",
    "-newkey",
    "ec",
    "-pkeyopt",
    "ec_paramgen_curve:prime256v1",
    "-keyout",
    KEY,
    "-out",
    CERT,
    "-days",
    "30",
    "-nodes",
    "-subj",
    "/CN=glc-bridge-dev",
    "-addext",
    "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:5.78.77.80",
  ]);
  console.log(`generated self-signed dev certificate in ${TLS_DIR}`);
}

const tls = { key: readFileSync(KEY), cert: readFileSync(CERT) };

function startProxy(listenPort, targetHost, targetPort, label) {
  const server = createServer(tls, (req, res) => {
    const upstream = httpRequest(
      {
        host: targetHost,
        port: targetPort,
        method: req.method,
        path: req.url,
        headers: { ...req.headers, host: `${targetHost}:${targetPort}` },
      },
      (upstreamRes) => {
        res.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(res);
      },
    );
    upstream.on("error", (error) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ error: `${label} upstream unreachable: ${error.message}` }),
      );
    });
    req.pipe(upstream);
  });

  // Raw TCP pass-through for WebSocket upgrades (HMR, RPC subscriptions).
  server.on("upgrade", (req, socket, head) => {
    const upstream = tcpConnect(targetPort, targetHost, () => {
      const headerLines = [`${req.method} ${req.url} HTTP/1.1`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        headerLines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
      }
      upstream.write(headerLines.join("\r\n") + "\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on("error", () => socket.destroy());
    socket.on("error", () => upstream.destroy());
  });

  server.listen(listenPort, "0.0.0.0", () => {
    console.log(
      `${label}: https://0.0.0.0:${listenPort} -> http://${targetHost}:${targetPort}`,
    );
  });
  return server;
}

const uiTarget = process.env.UI_TARGET ?? "127.0.0.1:3000";
const rpcTarget = process.env.RPC_TARGET ?? "127.0.0.1:8899";
const [uiHost, uiPort] = uiTarget.split(":");
const [rpcHost, rpcPort] = rpcTarget.split(":");

startProxy(Number(process.env.UI_TLS_PORT ?? 3443), uiHost, Number(uiPort), "ui");
startProxy(Number(process.env.RPC_TLS_PORT ?? 8443), rpcHost, Number(rpcPort), "rpc");

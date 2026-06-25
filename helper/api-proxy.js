#!/usr/bin/env node
'use strict';

const http = require('http');

const host = process.env.STREAMDOCK_API_HELPER_HOST || '127.0.0.1';
const port = Number(process.env.STREAMDOCK_API_HELPER_PORT || 41923);

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function resolveSecretRefs(value) {
  return String(value || '').replace(/\{\{secret:([A-Za-z0-9_.-]+)\}\}/g, (_, name) => {
    const envName = 'STREAMDOCK_SECRET_' + name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    return process.env[envName] || '';
  });
}

function sanitizeHeaders(headers) {
  const out = {};
  Object.keys(headers || {}).forEach(key => {
    if (!/^(connection|host|content-length|transfer-encoding)$/i.test(key)) {
      out[key] = resolveSecretRefs(headers[key]);
    }
  });
  return out;
}

async function handleRequest(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }
  if (req.method !== 'POST' || req.url !== '/request') {
    res.writeHead(404, corsHeaders({ 'content-type': 'text/plain' }));
    res.end('not found');
    return;
  }

  try {
    const body = JSON.parse(await readBody(req));
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(100, Number(body.timeoutMs) || 5000));
    const response = await fetch(body.url, {
      method: String(body.method || 'GET').toUpperCase(),
      headers: sanitizeHeaders(body.headers),
      body: body.body || undefined,
      signal: controller.signal
    });
    const text = await response.text();
    clearTimeout(timeout);
    res.writeHead(response.status, corsHeaders({ 'content-type': response.headers.get('content-type') || 'text/plain' }));
    res.end(text);
  } catch (error) {
    const status = error && error.name === 'AbortError' ? 504 : 502;
    res.writeHead(status, corsHeaders({ 'content-type': 'application/json' }));
    res.end(JSON.stringify({ error: error && error.message || 'proxy failed' }));
  }
}

function corsHeaders(extra) {
  return Object.assign({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-allow-headers': 'content-type'
  }, extra || {});
}

http.createServer(handleRequest).listen(port, host, () => {
  console.log(`streamdock-api-request helper listening on http://${host}:${port}/request`);
});

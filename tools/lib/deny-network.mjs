// IRUSHY test helper - forbid ALL outbound network access in this process.
//
// Preload it into the server:  node --import ./tools/lib/deny-network.mjs server/index.js
//
// fetch, outgoing sockets (net / tls), DNS lookups and http(s) requests all
// throw. Every attempt is written to stderr as "NETWORK_BLOCKED <kind>
// <target>", and the total is printed as "NETWORK_ATTEMPTS <n>" when the
// process exits. Incoming connections (the server listening on 127.0.0.1)
// are unaffected, because accepting a connection does not call connect().
//
// Optional, for the optional-backend tests only: IRUSHY_TEST_NET_ALLOW is a
// comma-separated list of exact loopback "host:port" pairs (for example the
// mock Ollama on 127.0.0.1:41234). fetch and sockets to exactly those pairs
// work and are counted as "NETWORK_ALLOWED <n>"; everything else is still
// blocked. Non-loopback entries are ignored, so the list can never open the
// real network. The server itself never reads this variable.

import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

let attempts = 0;
let allowedCount = 0;

const isLoopbackIp = (h) => /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h) || h === '::1';
const ALLOW = new Set(
  String(process.env.IRUSHY_TEST_NET_ALLOW || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => {
      const m = s.match(/^(.+):(\d{1,5})$/);
      return m && isLoopbackIp(m[1].replace(/^\[|\]$/g, ''));
    })
);

function describe(args) {
  try {
    const a = args[0];
    if (typeof a === 'string' || a instanceof URL) return String(a);
    if (a && typeof a === 'object') return `${a.host || a.hostname || a.path || '?'}:${a.port || ''}`;
    if (typeof a === 'number') return `port ${a}`;
  } catch {
    /* ignore */
  }
  return '?';
}

// host:port of a connect() call: (options), (port, host), or Node's own
// normalized form ([options, cb]) that net.connect passes to socket.connect.
function connectTarget(args) {
  let a = args[0];
  if (Array.isArray(a)) a = a[0];
  if (a && typeof a === 'object' && a.port !== undefined) return `${String(a.host || 'localhost').replace(/^\[|\]$/g, '')}:${a.port}`;
  if (typeof a === 'number' || (typeof a === 'string' && /^\d+$/.test(a))) return `${typeof args[1] === 'string' ? args[1] : 'localhost'}:${a}`;
  return null;
}

function fetchTarget(input) {
  try {
    const u = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
    if (u.protocol !== 'http:') return null; // plain http to loopback only
    return `${u.hostname.replace(/^\[|\]$/g, '')}:${u.port || '80'}`;
  } catch {
    return null;
  }
}

function deny(kind, target) {
  attempts += 1;
  process.stderr.write(`NETWORK_BLOCKED ${kind} ${target}\n`);
  const err = new Error(`IRUSHY test harness: outbound network access is blocked (${kind} ${target})`);
  err.code = 'ENETBLOCKED';
  throw err;
}

const realFetch = globalThis.fetch;
const realNetConnect = net.connect;
const realCreateConnection = net.createConnection;
const realSocketConnect = net.Socket.prototype.connect;

globalThis.fetch = async (input, init) => {
  const t = fetchTarget(input);
  if (t && ALLOW.has(t)) {
    allowedCount += 1;
    return realFetch(input, init);
  }
  return deny('fetch', describe([input]));
};
if (globalThis.WebSocket) globalThis.WebSocket = function WebSocketBlocked(url) { deny('websocket', String(url)); };

net.Socket.prototype.connect = function guardedConnect(...args) {
  const t = connectTarget(args);
  if (t && ALLOW.has(t)) return realSocketConnect.apply(this, args);
  return deny('net.Socket.connect', describe(args));
};
net.connect = (...args) => {
  const t = connectTarget(args);
  if (t && ALLOW.has(t)) return realNetConnect.apply(net, args);
  return deny('net.connect', describe(args));
};
net.createConnection = (...args) => {
  const t = connectTarget(args);
  if (t && ALLOW.has(t)) return realCreateConnection.apply(net, args);
  return deny('net.createConnection', describe(args));
};
tls.connect = (...args) => deny('tls.connect', describe(args));
http.request = (...args) => deny('http.request', describe(args));
http.get = (...args) => deny('http.get', describe(args));
https.request = (...args) => deny('https.request', describe(args));
https.get = (...args) => deny('https.get', describe(args));
// IP literals and "localhost" resolve locally without any network traffic
// (server.listen('127.0.0.1') calls dns.lookup internally); every other name
// lookup is blocked.
const isLocalName = (host) => net.isIP(String(host)) !== 0 || String(host) === 'localhost';
const realLookup = dns.lookup;
const realPromisesLookup = dns.promises && dns.promises.lookup;
for (const fn of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveMx', 'resolveTxt', 'resolveSrv', 'resolveCname', 'resolveNs']) {
  if (typeof dns[fn] === 'function') {
    dns[fn] = (host, ...rest) => (fn === 'lookup' && isLocalName(host) ? realLookup(host, ...rest) : deny(`dns.${fn}`, String(host)));
  }
  if (dns.promises && typeof dns.promises[fn] === 'function') {
    dns.promises[fn] = async (host, ...rest) => (fn === 'lookup' && isLocalName(host) ? realPromisesLookup(host, ...rest) : deny(`dns.promises.${fn}`, String(host)));
  }
}
syncBuiltinESMExports();

process.on('exit', () => {
  process.stderr.write(`NETWORK_ATTEMPTS ${attempts}\n`);
  if (ALLOW.size) process.stderr.write(`NETWORK_ALLOWED ${allowedCount}\n`);
});

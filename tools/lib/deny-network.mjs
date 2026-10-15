// IRUSHY test helper - forbid ALL outbound network access in this process.
//
// Preload it into the server:  node --import ./tools/lib/deny-network.mjs server/index.js
//
// fetch, outgoing sockets (net / tls), DNS lookups and http(s) requests all
// throw. Every attempt is written to stderr as "NETWORK_BLOCKED <kind>
// <target>", and the total is printed as "NETWORK_ATTEMPTS <n>" when the
// process exits. Incoming connections (the server listening on 127.0.0.1)
// are unaffected, because accepting a connection does not call connect().

import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { syncBuiltinESMExports } from 'node:module';

let attempts = 0;

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

function deny(kind, target) {
  attempts += 1;
  process.stderr.write(`NETWORK_BLOCKED ${kind} ${target}\n`);
  const err = new Error(`IRUSHY test harness: outbound network access is blocked (${kind} ${target})`);
  err.code = 'ENETBLOCKED';
  throw err;
}

globalThis.fetch = async (input) => deny('fetch', describe([input]));
if (globalThis.WebSocket) globalThis.WebSocket = function WebSocketBlocked(url) { deny('websocket', String(url)); };

net.Socket.prototype.connect = function blockedConnect(...args) {
  return deny('net.Socket.connect', describe(args));
};
net.connect = (...args) => deny('net.connect', describe(args));
net.createConnection = (...args) => deny('net.createConnection', describe(args));
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
});

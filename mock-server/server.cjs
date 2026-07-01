/**
 * mock-server/server.js — Simple Zabbix JSON-RPC mock for local development
 *
 * Usage:
 *   node mock-server/server.js
 *   PORT=3000 node mock-server/server.js
 *
 * Configure the extension with:
 *   API URL : http://localhost:3000/api_jsonrpc.php
 *   User    : Admin
 *   Password: zabbix
 */

'use strict';

const http = require('http');
const crypto = require('crypto');

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const RPC_PATH = '/api_jsonrpc.php';

const USERS = {
  Admin: { password: 'zabbix' },
  monitor: { password: 'monitor' },
};

const sessions = new Map();
const API_TOKENS = new Set(['zabbix-api-token-demo']);

let problems = [
  {
    eventid: '10001',
    name: 'High CPU utilization on web-01',
    severity: '4',
    clock: String(Math.floor(Date.now() / 1000) - 300),
    acknowledged: '0',
    objectid: '20001',
    hosts: [{ hostid: '100', name: 'web-01' }],
  },
  {
    eventid: '10002',
    name: 'Disk space low on db-01',
    severity: '3',
    clock: String(Math.floor(Date.now() / 1000) - 900),
    acknowledged: '0',
    objectid: '20002',
    hosts: [{ hostid: '101', name: 'db-01' }],
  },
  {
    eventid: '10003',
    name: 'Zabbix agent unreachable',
    severity: '5',
    clock: String(Math.floor(Date.now() / 1000) - 60),
    acknowledged: '0',
    objectid: '20003',
    hosts: [{ hostid: '102', name: 'cache-01' }],
  },
];

/** triggerid -> status (0=enabled, 1=disabled) */
const triggers = {
  '20001': { triggerid: '20001', status: '0' },
  '20002': { triggerid: '20002', status: '0' },
  '20003': { triggerid: '20003', status: '1' },
};

const hosts = [
  { hostid: '100', name: 'web-01', status: '0', maintenance_status: '0', hostgroups: [{ groupid: '1', name: 'Web servers' }] },
  { hostid: '101', name: 'db-01', status: '0', maintenance_status: '0', hostgroups: [{ groupid: '2', name: 'Database' }] },
  { hostid: '102', name: 'cache-01', status: '0', maintenance_status: '0', hostgroups: [{ groupid: '3', name: 'Cache' }] },
  { hostid: '103', name: 'old-01', status: '1', maintenance_status: '0', hostgroups: [{ groupid: '4', name: 'Decommissioned' }] },
  { hostid: '104', name: 'maint-01', status: '0', maintenance_status: '1', hostgroups: [{ groupid: '5', name: 'Maintenance' }] },
];

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(body));
}

function rpcResult(id, result) {
  return { jsonrpc: '2.0', result, id };
}

function rpcError(id, code, message, data) {
  return { jsonrpc: '2.0', error: { code, message, data }, id };
}

function getAuthToken(req, body) {
  if (body.auth && (sessions.has(body.auth) || API_TOKENS.has(body.auth))) return body.auth;
  const header = req.headers.authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (match && (sessions.has(match[1]) || API_TOKENS.has(match[1]))) return match[1];
  return null;
}

function handleRpc(body, req) {
  const { method, params = {}, id } = body;
  const auth = getAuthToken(req, body);

  if (method === 'apiinfo.version') {
    return rpcResult(id, '7.0.0');
  }

  if (method === 'user.login') {
    const user = USERS[params.username];
    if (!user || user.password !== params.password) {
      return rpcError(id, -32602, 'Not authorized', 'Login name or password is incorrect');
    }
    const token = crypto.randomBytes(16).toString('hex');
    sessions.set(token, params.username);
    return rpcResult(id, token);
  }

  if (method === 'user.logout') {
    if (auth) sessions.delete(auth);
    return rpcResult(id, true);
  }

  if (!auth) {
    return rpcError(id, -32602, 'Not authorized', 'Session expired');
  }

  if (method === 'problem.get') {
    return rpcResult(id, problems);
  }

  if (method === 'trigger.get') {
    const ids = params.triggerids ?? [];
    let result = ids
      .map((tid) => triggers[tid])
      .filter(Boolean);
    const filter = params.filter ?? {};
    if (filter.status !== undefined) {
      result = result.filter((t) => t.status === String(filter.status));
    }
    if (params.monitored) {
      result = result.filter((t) => t.status === '0');
    }
    return rpcResult(id, result.map((t) => ({ triggerid: t.triggerid })));
  }

  if (method === 'host.get') {
    let result = hosts;
    const filter = params.filter ?? {};
    if (filter.status !== undefined) {
      result = result.filter((h) => h.status === String(filter.status));
    }
    if (filter.maintenance_status !== undefined) {
      result = result.filter(
        (h) => (h.maintenance_status ?? '0') === String(filter.maintenance_status),
      );
    }
    return rpcResult(id, result);
  }

  if (method === 'user.get') {
    return rpcResult(id, [{ userid: '1' }]);
  }

  if (method === 'event.get') {
    const hostids = params.hostids ?? [];
    const eventids = params.eventids ?? [];
    const limit = params.limit ?? 50;
    let source = problems;
    if (eventids.length > 0) {
      source = problems.filter((p) => eventids.includes(p.eventid));
    } else if (hostids.length > 0) {
      source = problems.filter((p) => hostids.includes(p.hosts?.[0]?.hostid));
    }
    const events = source.slice(0, limit).map((p) => {
      const event = {
        eventid: p.eventid,
        name: p.name,
        severity: p.severity,
        clock: p.clock,
        acknowledged: p.acknowledged,
        value: '1',
      };
      if (params.selectHosts) {
        event.hosts = p.hosts ?? [];
      }
      return event;
    });
    return rpcResult(id, events);
  }

  if (method === 'event.acknowledge') {
    const eventids = params.eventids ?? [];
    for (const p of problems) {
      if (eventids.includes(p.eventid)) p.acknowledged = '1';
    }
    return rpcResult(id, true);
  }

  if (method === 'service.get') {
    return rpcResult(id, [
      { serviceid: '1', name: 'Web tier', status: '1' },
      { serviceid: '2', name: 'Database tier', status: '0' },
      { serviceid: '3', name: 'Cache tier', status: '2' },
    ]);
  }

  return rpcError(id, -32601, 'Method not found', `Unknown method: ${method}`);
}

const server = http.createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem;background:#0f172a;color:#e2e8f0">
      <h1>Zabbix JSON-RPC Mock</h1>
      <p>Endpoint: <code>http://localhost:${PORT}${RPC_PATH}</code></p>
      <p>User: <code>Admin</code> / Password: <code>zabbix</code></p>
      <p>Problems: ${problems.length} · Hosts: ${hosts.length}</p>
      <h2>API</h2>
      <ul>
        <li><code>GET /api/status</code></li>
        <li><code>POST /api/problems</code> — add a problem (JSON body)</li>
        <li><code>DELETE /api/problems</code> — clear problems</li>
      </ul>
    </body></html>`);
    return;
  }

  if (req.url === '/api/status' && req.method === 'GET') {
    return json(res, 200, { status: 'running', problems: problems.length, hosts: hosts.length, sessions: sessions.size });
  }

  if (req.url === '/api/problems' && req.method === 'DELETE') {
    problems = [];
    return json(res, 200, { success: true });
  }

  if (req.url === '/api/problems' && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw || '{}');
        const p = {
          eventid: String(20000 + problems.length + 1),
          name: body.name ?? 'New test problem',
          severity: String(body.severity ?? 4),
          clock: String(Math.floor(Date.now() / 1000)),
          acknowledged: '0',
          objectid: String(30000 + problems.length + 1),
          hosts: [{ hostid: '100', name: body.hostName ?? 'web-01' }],
        };
        problems.unshift(p);
        json(res, 201, { success: true, problem: p });
      } catch (e) {
        json(res, 400, { error: String(e) });
      }
    });
    return;
  }

  if (req.url?.startsWith(RPC_PATH) && req.method === 'POST') {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      try {
        const body = JSON.parse(raw);
        json(res, 200, handleRpc(body, req));
      } catch (e) {
        json(res, 400, rpcError(0, -32700, 'Parse error', String(e)));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`Zabbix mock server → http://localhost:${PORT}${RPC_PATH}`);
  console.log('Credentials: Admin / zabbix');
});

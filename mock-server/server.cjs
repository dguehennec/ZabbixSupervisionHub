/**
 * mock-server/server.cjs — Zabbix JSON-RPC mock + Web Admin UI for local development
 *
 * Usage:
 *   node mock-server/server.cjs
 *   PORT=3000 node mock-server/server.cjs
 *
 * Configure the extension with:
 *   API URL : http://localhost:3000/api_jsonrpc.php
 *   User    : Admin
 *   Password: zabbix
 *
 * Web admin dashboard (create/delete hosts, generate/delete alerts):
 *   http://localhost:3000/
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

/** Zabbix severity levels (0=Not classified .. 5=Disaster) */
const SEVERITIES = [
  { value: 0, name: 'Not classified', color: '#97AAB3' },
  { value: 1, name: 'Information', color: '#7499FF' },
  { value: 2, name: 'Warning', color: '#FFC859' },
  { value: 3, name: 'Average', color: '#FFA059' },
  { value: 4, name: 'High', color: '#E97659' },
  { value: 5, name: 'Disaster', color: '#E45959' },
];

let nextHostId = 105;
let nextGroupId = 6;
let nextEventId = 20000;
let nextObjectId = 30000;

const groups = new Map([
  ['1', 'Web servers'],
  ['2', 'Database'],
  ['3', 'Cache'],
  ['4', 'Decommissioned'],
  ['5', 'Maintenance'],
]);

let hosts = [
  { hostid: '100', name: 'web-01', status: '0', maintenance_status: '0', hostgroups: [{ groupid: '1', name: 'Web servers' }] },
  { hostid: '101', name: 'db-01', status: '0', maintenance_status: '0', hostgroups: [{ groupid: '2', name: 'Database' }] },
  { hostid: '102', name: 'cache-01', status: '0', maintenance_status: '0', hostgroups: [{ groupid: '3', name: 'Cache' }] },
  { hostid: '103', name: 'old-01', status: '1', maintenance_status: '0', hostgroups: [{ groupid: '4', name: 'Decommissioned' }] },
  { hostid: '104', name: 'maint-01', status: '0', maintenance_status: '1', hostgroups: [{ groupid: '5', name: 'Maintenance' }] },
];

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

function findHost(hostid) {
  return hosts.find((h) => h.hostid === String(hostid));
}

function findOrCreateGroup(name) {
  for (const [id, gname] of groups) {
    if (gname.toLowerCase() === String(name).toLowerCase()) return { groupid: id, name: gname };
  }
  const groupid = String(nextGroupId++);
  groups.set(groupid, name);
  return { groupid, name };
}

function createHost({ name, group, status, maintenance_status }) {
  const hostid = String(nextHostId++);
  const grp = findOrCreateGroup(group && group.trim() ? group.trim() : 'Other');
  const host = {
    hostid,
    name: name && name.trim() ? name.trim() : `host-${hostid}`,
    status: String(status ?? '0'),
    maintenance_status: String(maintenance_status ?? '0'),
    hostgroups: [grp],
  };
  hosts.push(host);
  triggers[String(nextObjectId)] = { triggerid: String(nextObjectId), status: '0' };
  return host;
}

function deleteHost(hostid) {
  const before = hosts.length;
  hosts = hosts.filter((h) => h.hostid !== String(hostid));
  problems = problems.filter((p) => p.hosts?.[0]?.hostid !== String(hostid));
  return hosts.length !== before;
}

function createProblem({ name, severity, hostid }) {
  const host = findHost(hostid) ?? hosts[0];
  const eventid = String(++nextEventId);
  const objectid = String(++nextObjectId);
  const p = {
    eventid,
    name: name && name.trim() ? name.trim() : `Synthetic alert on ${host ? host.name : 'unknown'}`,
    severity: String(severity ?? 2),
    clock: String(Math.floor(Date.now() / 1000)),
    acknowledged: '0',
    objectid,
    hosts: host ? [{ hostid: host.hostid, name: host.name }] : [],
  };
  triggers[objectid] = { triggerid: objectid, status: '0' };
  problems.unshift(p);
  return p;
}

function deleteProblem(eventid) {
  const before = problems.length;
  problems = problems.filter((p) => p.eventid !== String(eventid));
  return problems.length !== before;
}

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(JSON.stringify(body));
}

function html(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
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

const ADMIN_PAGE = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Zabbix Mock — Admin</title>
<style>
  :root {
    --bg: #0f172a;
    --panel: #16213a;
    --panel-2: #1c2947;
    --border: #2a3a5c;
    --text: #e2e8f0;
    --muted: #94a3b8;
    --accent: #4f8cff;
    --accent-2: #3672e0;
    --danger: #e45959;
    --danger-2: #c94747;
    --radius: 10px;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 2rem;
  }
  h1 { font-size: 1.4rem; margin: 0 0 .25rem; }
  .subtitle { color: var(--muted); margin: 0 0 1.5rem; font-size: .9rem; }
  .subtitle code { background: var(--panel-2); padding: .1rem .4rem; border-radius: 4px; }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1.5rem;
    max-width: 1200px;
  }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .panel {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.25rem;
  }
  .panel h2 {
    font-size: 1rem;
    margin: 0 0 1rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .badge {
    background: var(--panel-2);
    color: var(--muted);
    font-size: .75rem;
    padding: .15rem .5rem;
    border-radius: 999px;
    font-weight: 400;
  }
  form.inline {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: .5rem;
    margin-bottom: 1rem;
    align-items: end;
  }
  label {
    display: block;
    font-size: .72rem;
    color: var(--muted);
    margin-bottom: .3rem;
    text-transform: uppercase;
    letter-spacing: .03em;
  }
  input, select {
    width: 100%;
    background: var(--panel-2);
    border: 1px solid var(--border);
    color: var(--text);
    padding: .5rem .6rem;
    border-radius: 6px;
    font-size: .85rem;
  }
  input:focus, select:focus { outline: none; border-color: var(--accent); }
  button {
    background: var(--accent);
    color: white;
    border: none;
    padding: .55rem .9rem;
    border-radius: 6px;
    font-size: .85rem;
    cursor: pointer;
    font-weight: 600;
    white-space: nowrap;
  }
  button:hover { background: var(--accent-2); }
  button.danger { background: transparent; color: var(--danger); border: 1px solid var(--danger); padding: .3rem .55rem; font-weight: 500; }
  button.danger:hover { background: var(--danger); color: white; }
  button.danger-outline {
    background: transparent; border: 1px solid var(--danger); color: var(--danger); width: 100%;
  }
  button.danger-outline:hover { background: var(--danger); color: white; }
  table { width: 100%; border-collapse: collapse; font-size: .85rem; }
  th, td { text-align: left; padding: .5rem .4rem; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 500; font-size: .72rem; text-transform: uppercase; letter-spacing: .03em; }
  tr:last-child td { border-bottom: none; }
  .empty { color: var(--muted); font-size: .85rem; padding: 1rem 0; text-align: center; }
  .sev-pill {
    display: inline-block;
    padding: .15rem .55rem;
    border-radius: 999px;
    font-size: .72rem;
    font-weight: 600;
    color: #0f172a;
  }
  .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: .4rem; }
  .status-up { background: #4ade80; }
  .status-down { background: #64748b; }
  .status-maint { background: #facc15; }
  .row-actions { text-align: right; white-space: nowrap; }
  .footer-note { margin-top: 1.5rem; color: var(--muted); font-size: .78rem; }
  .toast {
    position: fixed; bottom: 1.5rem; right: 1.5rem;
    background: var(--panel-2); border: 1px solid var(--border);
    padding: .7rem 1rem; border-radius: 8px; font-size: .85rem;
    opacity: 0; transform: translateY(10px); transition: all .25s;
    pointer-events: none;
  }
  .toast.show { opacity: 1; transform: translateY(0); }
</style>
</head>
<body>
  <h1>🦓 Zabbix Mock Server</h1>
  <p class="subtitle">
    JSON-RPC endpoint&nbsp;<code>http://localhost:${PORT}${RPC_PATH}</code> ·
    Identifiants&nbsp;<code>Admin</code> / <code>zabbix</code> ·
    Version simulée <code>7.0.0</code>
  </p>

  <div class="grid">
    <div class="panel">
      <h2>Machines <span id="host-count" class="badge">0</span></h2>
      <form id="host-form" class="inline">
        <div>
          <label>Nom</label>
          <input name="name" placeholder="web-02" required>
        </div>
        <div>
          <label>Groupe</label>
          <input name="group" placeholder="Web servers">
        </div>
        <div>
          <label>Statut</label>
          <select name="status">
            <option value="0">Activé</option>
            <option value="1">Désactivé</option>
          </select>
        </div>
        <div>
          <label>Maintenance</label>
          <select name="maintenance_status">
            <option value="0">Non</option>
            <option value="1">Oui</option>
          </select>
        </div>
        <button type="submit">+ Créer</button>
      </form>
      <table>
        <thead><tr><th>Nom</th><th>Groupe</th><th>Statut</th><th></th></tr></thead>
        <tbody id="host-table"></tbody>
      </table>
      <div id="host-empty" class="empty" style="display:none">Aucune machine</div>
    </div>

    <div class="panel">
      <h2>Alertes <span id="problem-count" class="badge">0</span></h2>
      <form id="problem-form" class="inline">
        <div>
          <label>Message</label>
          <input name="name" placeholder="High CPU on...">
        </div>
        <div>
          <label>Machine</label>
          <select name="hostid" id="problem-hostid"></select>
        </div>
        <div>
          <label>Sévérité</label>
          <select name="severity" id="severity-select"></select>
        </div>
        <button type="submit">+ Générer</button>
      </form>
      <table>
        <thead><tr><th>Alerte</th><th>Machine</th><th>Sévérité</th><th></th></tr></thead>
        <tbody id="problem-table"></tbody>
      </table>
      <div id="problem-empty" class="empty" style="display:none">Aucune alerte</div>
      <button class="danger-outline" id="clear-all" style="margin-top:.75rem">Supprimer toutes les alertes</button>
    </div>
  </div>

  <p class="footer-note">Cette interface pilote directement l'état interne du serveur mock. Les changements sont visibles immédiatement via l'API JSON-RPC utilisée par l'extension.</p>

  <div class="toast" id="toast"></div>

<script>
const SEVERITIES = ${JSON.stringify(SEVERITIES)};

function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 1800);
}

function sevPill(sevValue) {
  const s = SEVERITIES.find(s => String(s.value) === String(sevValue)) || SEVERITIES[0];
  return \`<span class="sev-pill" style="background:\${s.color}">\${s.name}</span>\`;
}

function statusDot(host) {
  if (host.maintenance_status === '1') return '<span class="status-dot status-maint"></span>Maintenance';
  if (host.status === '1') return '<span class="status-dot status-down"></span>Désactivé';
  return '<span class="status-dot status-up"></span>Activé';
}

async function loadHosts() {
  const res = await fetch('/api/hosts');
  const hosts = await res.json();
  document.getElementById('host-count').textContent = hosts.length;
  const tbody = document.getElementById('host-table');
  tbody.innerHTML = '';
  document.getElementById('host-empty').style.display = hosts.length ? 'none' : 'block';
  for (const h of hosts) {
    const tr = document.createElement('tr');
    tr.innerHTML = \`
      <td>\${h.name}</td>
      <td>\${(h.hostgroups && h.hostgroups[0] && h.hostgroups[0].name) || '—'}</td>
      <td>\${statusDot(h)}</td>
      <td class="row-actions"><button class="danger" data-hostid="\${h.hostid}">Supprimer</button></td>
    \`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('button[data-hostid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch('/api/hosts/' + btn.dataset.hostid, { method: 'DELETE' });
      toast('Machine supprimée');
      await Promise.all([loadHosts(), loadProblems()]);
    });
  });

  const select = document.getElementById('problem-hostid');
  const current = select.value;
  select.innerHTML = hosts.map(h => \`<option value="\${h.hostid}">\${h.name}</option>\`).join('');
  if (hosts.some(h => h.hostid === current)) select.value = current;
}

async function loadProblems() {
  const res = await fetch('/api/problems');
  const problems = await res.json();
  document.getElementById('problem-count').textContent = problems.length;
  const tbody = document.getElementById('problem-table');
  tbody.innerHTML = '';
  document.getElementById('problem-empty').style.display = problems.length ? 'none' : 'block';
  for (const p of problems) {
    const tr = document.createElement('tr');
    const hostName = (p.hosts && p.hosts[0] && p.hosts[0].name) || '—';
    tr.innerHTML = \`
      <td>\${p.name}</td>
      <td>\${hostName}</td>
      <td>\${sevPill(p.severity)}</td>
      <td class="row-actions"><button class="danger" data-eventid="\${p.eventid}">Supprimer</button></td>
    \`;
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll('button[data-eventid]').forEach(btn => {
    btn.addEventListener('click', async () => {
      await fetch('/api/problems/' + btn.dataset.eventid, { method: 'DELETE' });
      toast('Alerte supprimée');
      loadProblems();
    });
  });
}

function initSeverityOptions() {
  const select = document.getElementById('severity-select');
  select.innerHTML = SEVERITIES.map(s => \`<option value="\${s.value}">\${s.name}</option>\`).join('');
  select.value = '2';
}

document.getElementById('host-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  await fetch('/api/hosts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  form.reset();
  toast('Machine créée');
  await loadHosts();
});

document.getElementById('problem-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const data = Object.fromEntries(new FormData(form).entries());
  await fetch('/api/problems', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  form.querySelector('input[name="name"]').value = '';
  toast('Alerte générée');
  await loadProblems();
});

document.getElementById('clear-all').addEventListener('click', async () => {
  await fetch('/api/problems', { method: 'DELETE' });
  toast('Toutes les alertes supprimées');
  await loadProblems();
});

initSeverityOptions();
loadHosts().then(loadProblems);
setInterval(() => { loadHosts(); loadProblems(); }, 5000);
</script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // ---- Web admin dashboard ----
  if (req.method === 'GET' && url.pathname === '/') {
    return html(res, 200, ADMIN_PAGE);
  }

  // ---- Admin REST API: hosts ----
  if (url.pathname === '/api/hosts' && req.method === 'GET') {
    return json(res, 200, hosts);
  }

  if (url.pathname === '/api/hosts' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const h = createHost(body);
      return json(res, 201, h);
    } catch (e) {
      return json(res, 400, { error: String(e) });
    }
  }

  if (url.pathname.startsWith('/api/hosts/') && req.method === 'DELETE') {
    const hostid = url.pathname.split('/').pop();
    const removed = deleteHost(hostid);
    return json(res, removed ? 200 : 404, { success: removed });
  }

  // ---- Admin REST API: problems / alerts ----
  if (url.pathname === '/api/problems' && req.method === 'GET') {
    return json(res, 200, problems);
  }

  if (url.pathname === '/api/problems' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const p = createProblem(body);
      return json(res, 201, { success: true, problem: p });
    } catch (e) {
      return json(res, 400, { error: String(e) });
    }
  }

  if (url.pathname === '/api/problems' && req.method === 'DELETE') {
    problems = [];
    return json(res, 200, { success: true });
  }

  if (url.pathname.startsWith('/api/problems/') && req.method === 'DELETE') {
    const eventid = url.pathname.split('/').pop();
    const removed = deleteProblem(eventid);
    return json(res, removed ? 200 : 404, { success: removed });
  }

  if (url.pathname === '/api/status' && req.method === 'GET') {
    return json(res, 200, { status: 'running', problems: problems.length, hosts: hosts.length, sessions: sessions.size });
  }

  if (url.pathname === '/api/severities' && req.method === 'GET') {
    return json(res, 200, SEVERITIES);
  }

  // ---- Zabbix JSON-RPC ----
  if (url.pathname.startsWith(RPC_PATH) && req.method === 'POST') {
    try {
      const body = await readBody(req);
      return json(res, 200, handleRpc(body, req));
    } catch (e) {
      return json(res, 400, rpcError(0, -32700, 'Parse error', String(e)));
    }
  }

  res.writeHead(404);
  res.end('Not Found');
});

server.listen(PORT, () => {
  console.log(`Zabbix mock server   → http://localhost:${PORT}${RPC_PATH}`);
  console.log(`Admin dashboard      → http://localhost:${PORT}/`);
  console.log('Credentials: Admin / zabbix');
});

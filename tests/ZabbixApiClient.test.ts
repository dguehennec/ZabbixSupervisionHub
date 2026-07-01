import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ZabbixApiClient, requiresBearerAuth, supportsProblemSelectHosts } from '../src/modules/service/ZabbixApiClient';
import { AuthError, NetworkError } from '../src/types';

vi.mock('../src/modules/constant/constants', async () => {
  const actual = await vi.importActual<typeof import('../src/modules/constant/constants')>(
    '../src/modules/constant/constants',
  );
  return {
    Constants: {
      ...actual.Constants,
      RETRY: { ...actual.Constants.RETRY, MAX_ATTEMPTS: 1 },
    },
  };
});

describe('ZabbixApiClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('normalizes API URL on construction', () => {
    const client = new ZabbixApiClient('https://zabbix.example.com');
    expect(client.apiUrl).toBe('https://zabbix.example.com/api_jsonrpc.php');
  });

  it('calls apiinfo.version', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({ jsonrpc: '2.0', result: '7.0.0', id: 1 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZabbixApiClient('http://localhost:3000');
    const version = await client.getVersion();
    expect(version).toBe('7.0.0');
    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api_jsonrpc.php',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('logs in and sets auth token', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({ jsonrpc: '2.0', result: 'auth-token-abc', id: 1 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZabbixApiClient('http://localhost:3000');
    const token = await client.login('Admin', 'zabbix');
    expect(token).toBe('auth-token-abc');
    expect(client.isAuthenticated).toBe(true);
  });

  it('throws AuthError on RPC error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          jsonrpc: '2.0',
          error: { code: -32602, message: 'Not authorized', data: 'Login failed' },
          id: 1,
        }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZabbixApiClient('http://localhost:3000');
    await expect(client.login('bad', 'creds')).rejects.toBeInstanceOf(AuthError);
  });

  it('does not treat invalid params as AuthError', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: 'token', id: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            jsonrpc: '2.0',
            error: {
              code: -32602,
              message: 'Invalid params.',
              data: 'Invalid parameter "/suppressed": unexpected parameter.',
            },
            id: 2,
          }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZabbixApiClient('http://localhost:3000');
    await client.login('Admin', 'zabbix');
    await expect(client.getProblems()).rejects.not.toBeInstanceOf(AuthError);
  });

  it('throws NetworkError on HTTP failure', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 503, statusText: 'Unavailable' });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZabbixApiClient('http://localhost:3000');
    await expect(client.getVersion()).rejects.toBeInstanceOf(NetworkError);
  }, 15_000);

  it('fetches problems when authenticated (Zabbix 6.x with selectHosts)', async () => {
    const problems = [
      {
        eventid: '100',
        name: 'CPU high',
        severity: '4',
        clock: '1710000000',
        acknowledged: '0',
        objectid: '200',
        hosts: [{ hostid: '50', name: 'web-01' }],
      },
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({ jsonrpc: '2.0', result: '6.4.0', id: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({ jsonrpc: '2.0', result: 'token', id: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({ jsonrpc: '2.0', result: problems, id: 3 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({ jsonrpc: '2.0', result: [{ triggerid: '200' }], id: 4 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZabbixApiClient('http://localhost:3000');
    await client.getVersion();
    await client.login('Admin', 'zabbix');
    const result = await client.getProblems();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('CPU high');
    expect(result[0].hosts?.[0]?.name).toBe('web-01');

    const problemCall = fetchMock.mock.calls[2];
    const body = JSON.parse(String(problemCall[1]?.body));
    expect(body.params.selectHosts).toEqual(['hostid', 'name']);
  });

  it('fetches problems and hosts in parallel without aborting each other', async () => {
    const problems = [{ eventid: '1', name: 'P1', severity: '4', clock: '1', acknowledged: '0', objectid: '1' }];
    const hosts = [{ hostid: '10', name: 'host-a', status: '0' }];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: '7.0.0', id: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: 'token', id: 2 }),
      })
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.method === 'problem.get') {
          expect(body.params.selectHosts).toBeUndefined();
          return { ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', result: problems, id: body.id }) };
        }
        if (body.method === 'event.get') {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                jsonrpc: '2.0',
                result: [{ eventid: '1', hosts: [{ hostid: '10', name: 'host-a' }] }],
                id: body.id,
              }),
          };
        }
        if (body.method === 'trigger.get') {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                jsonrpc: '2.0',
                result: (body.params.triggerids ?? []).map((id: string) => ({ triggerid: id })),
                id: body.id,
              }),
          };
        }
        if (body.method === 'host.get') {
          return { ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', result: hosts, id: body.id }) };
        }
        return { ok: false, status: 500, text: async () => '' };
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZabbixApiClient('http://localhost:3000');
    await client.getVersion();
    await client.login('Admin', 'zabbix');

    const [gotProblems, gotHosts] = await Promise.all([client.getProblems(), client.getHosts()]);
    expect(gotProblems).toHaveLength(1);
    expect(gotProblems[0].hosts?.[0]?.name).toBe('host-a');
    expect(gotHosts).toHaveLength(1);
  });

  it('requires Bearer auth only for Zabbix 7.2+', () => {
    expect(requiresBearerAuth('7.2.0')).toBe(true);
    expect(requiresBearerAuth('7.2.15')).toBe(true);
    expect(requiresBearerAuth('7.0.0')).toBe(false);
    expect(requiresBearerAuth('6.4.0')).toBe(false);
    expect(requiresBearerAuth('6.0.0')).toBe(false);
  });

  it('omits selectHosts on problem.get for Zabbix 7.0+', () => {
    expect(supportsProblemSelectHosts('6.4.0')).toBe(true);
    expect(supportsProblemSelectHosts('7.0.0')).toBe(false);
    expect(supportsProblemSelectHosts('7.2.15')).toBe(false);
  });

  it('sends body.auth for Zabbix 7.0 (not Bearer)', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: '7.0.0', id: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: 'token-abc', id: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: [], id: 3 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZabbixApiClient('http://localhost:3000');
    await client.getVersion();
    await client.login('Admin', 'zabbix');
    await client.getProblems();

    const problemCall = fetchMock.mock.calls[2];
    const body = JSON.parse(String(problemCall[1]?.body));
    expect(body.method).toBe('problem.get');
    expect(body.params.selectHosts).toBeUndefined();
    expect(body.auth).toBe('token-abc');
    expect(problemCall[1]?.headers?.Authorization).toBeUndefined();
  });

  it('sends Bearer header for Zabbix 7.2+', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: '7.2.15', id: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: 'token-xyz', id: 2 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            jsonrpc: '2.0',
            result: [{ eventid: '100', name: 'CPU high', severity: '4', clock: '1', acknowledged: '0', objectid: '200' }],
            id: 3,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            jsonrpc: '2.0',
            result: [{ eventid: '100', hosts: [{ hostid: '50', name: 'web-01' }] }],
            id: 4,
          }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({ jsonrpc: '2.0', result: [{ triggerid: '200' }], id: 5 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZabbixApiClient('http://localhost:3000');
    await client.getVersion();
    await client.login('Admin', 'zabbix');
    const result = await client.getProblems();

    const problemCall = fetchMock.mock.calls[2];
    const problemBody = JSON.parse(String(problemCall[1]?.body));
    expect(problemBody.method).toBe('problem.get');
    expect(problemBody.params.selectHosts).toBeUndefined();
    expect(problemBody.auth).toBeUndefined();
    expect(problemCall[1]?.headers?.Authorization).toBe('Bearer token-xyz');

    const eventCall = fetchMock.mock.calls[3];
    const eventBody = JSON.parse(String(eventCall[1]?.body));
    expect(eventBody.method).toBe('event.get');
    expect(eventBody.params.selectHosts).toEqual(['hostid', 'name']);
    expect(result[0].hosts?.[0]?.name).toBe('web-01');
  });

  it('authenticates with API token without user.login', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: '7.2.15', id: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: [{ userid: '1' }], id: 2 }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZabbixApiClient('http://localhost:3000');
    const token = await client.authenticateWithApiToken('my-api-token');
    expect(token).toBe('my-api-token');
    expect(client.isAuthenticated).toBe(true);

    const authCall = fetchMock.mock.calls[1];
    expect(authCall[1]?.headers?.Authorization).toBe('Bearer my-api-token');
    const body = JSON.parse(String(authCall[1]?.body));
    expect(body.method).toBe('user.get');
    expect(body.auth).toBeUndefined();
  });

  it('filters disabled and maintenance hosts in host.get', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: '7.0.0', id: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: 'token', id: 2 }),
      })
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.method === 'host.get') {
          return {
            ok: true,
            text: async () => JSON.stringify({ jsonrpc: '2.0', result: [], id: body.id }),
          };
        }
        return { ok: false, status: 500, text: async () => '' };
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZabbixApiClient('http://localhost:3000');
    await client.getVersion();
    await client.login('Admin', 'zabbix');

    await client.getHosts({ excludeDisabledHosts: true, excludeMaintenanceHosts: true });

    const hostCall = fetchMock.mock.calls[2];
    const body = JSON.parse(String(hostCall[1]?.body));
    expect(body.method).toBe('host.get');
    expect(body.params.filter).toEqual({ status: 0, maintenance_status: 0 });

    await client.getHosts({ excludeDisabledHosts: false });

    const hostCall2 = fetchMock.mock.calls[3];
    const body2 = JSON.parse(String(hostCall2[1]?.body));
    expect(body2.params.filter).toBeUndefined();
  });

  it('excludes problems from disabled triggers (Zabbix UI behavior)', async () => {
    const problems = [
      { eventid: '1', name: 'Active', severity: '4', clock: '1', acknowledged: '0', objectid: '10' },
      { eventid: '2', name: 'Disabled trigger', severity: '4', clock: '2', acknowledged: '0', objectid: '20' },
    ];

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: '7.2.15', id: 1 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () => JSON.stringify({ jsonrpc: '2.0', result: 'token', id: 2 }),
      })
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        if (body.method === 'problem.get') {
          return { ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', result: problems, id: body.id }) };
        }
        if (body.method === 'event.get') {
          return {
            ok: true,
            text: async () =>
              JSON.stringify({
                jsonrpc: '2.0',
                result: problems.map((p) => ({
                  eventid: p.eventid,
                  hosts: [{ hostid: '1', name: 'host' }],
                })),
                id: body.id,
              }),
          };
        }
        if (body.method === 'trigger.get') {
          expect(body.params.monitored).toBe(true);
          expect(body.params.filter).toEqual({ status: 0 });
          const enabled = new Set(['10']);
          const result = (body.params.triggerids ?? [])
            .filter((id: string) => enabled.has(id))
            .map((id: string) => ({ triggerid: id }));
          return { ok: true, text: async () => JSON.stringify({ jsonrpc: '2.0', result, id: body.id }) };
        }
        return { ok: false, status: 500, text: async () => '' };
      });
    vi.stubGlobal('fetch', fetchMock);

    const client = new ZabbixApiClient('http://localhost:3000');
    await client.getVersion();
    await client.login('Admin', 'zabbix');

    const filtered = await client.getProblems();
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('Active');

    const all = await client.getProblems({ excludeDisabledTriggers: false });
    expect(all).toHaveLength(2);
  });
});

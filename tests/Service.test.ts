import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { resetChromeMocks } from './setup';
import {
  ServiceEventType,
  RequestStatus,
  ZabbixAuthMethod,
  ZabbixSeverity,
  AuthError,
  NetworkError,
} from '../src/types';

vi.mock('../src/modules/constant/constants', async () => {
  const actual = await vi.importActual<typeof import('../src/modules/constant/constants')>(
    '../src/modules/constant/constants',
  );
  return {
    Constants: {
      ...actual.Constants,
      SERVICE: {
        ...actual.Constants.SERVICE,
        CONNECT_BASE_WAIT_AFTER_FAILURE: 10,
        CONNECT_MAX_WAIT_AFTER_FAILURE: 50,
        POLL_INTERVAL_MS: 1000,
      },
    },
  };
});

const mockClient = {
  isAuthenticated: false,
  token: null as string | null,
  getVersion: vi.fn().mockResolvedValue('7.0.0'),
  login: vi.fn().mockImplementation(async () => {
    mockClient.isAuthenticated = true;
    return 'auth-token';
  }),
  authenticateWithApiToken: vi.fn().mockImplementation(async (token: string) => {
    mockClient.isAuthenticated = true;
    return token;
  }),
  getProblems: vi.fn().mockResolvedValue([
    {
      eventid: '101',
      name: 'Test problem',
      severity: '4',
      clock: '1710000000',
      acknowledged: '0',
      objectid: '1',
      hosts: [{ hostid: '10', name: 'host-a' }],
    },
  ]),
  getHosts: vi.fn().mockResolvedValue([
    {
      hostid: '10',
      name: 'host-a',
      status: '0',
      hostgroups: [{ groupid: '1', name: 'Dev servers' }],
    },
  ]),
  abort: vi.fn(),
};

vi.mock('../src/modules/service/ZabbixApiClient', () => ({
  ZabbixApiClient: vi.fn(() => mockClient),
}));

vi.mock('../src/modules/service/BrowserService', () => ({
  BrowserService: { notify: vi.fn(), openWebInterface: vi.fn(), updateBadge: vi.fn() },
}));

vi.mock('../src/modules/service/ProblemNotifier', () => ({
  ProblemNotifier: vi.fn().mockImplementation(() => ({ fire: vi.fn() })),
}));

vi.mock('../src/db/schema', () => ({
  cacheProblems: vi.fn().mockResolvedValue(undefined),
  cacheHosts: vi.fn().mockResolvedValue(undefined),
  clearInstanceCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/modules/service/SnoozeManager', () => ({
  SnoozeManager: {
    isSnoozed: vi.fn().mockResolvedValue(false),
  },
}));

import { Service } from '../src/modules/controller/Service';
import { Prefs } from '../src/modules/service/Prefs';
import { ZabbixApiClient } from '../src/modules/service/ZabbixApiClient';

const INSTANCE_ID = 'inst-service-1';

describe('Service', () => {
  const events: Array<{ event: ServiceEventType; data?: unknown }> = [];

  const delegate = {
    instanceId: INSTANCE_ID,
    onEvent: (event: ServiceEventType, data?: unknown) => {
      events.push({ event, data });
    },
    onSessionChanged: vi.fn(),
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    resetChromeMocks();
    events.length = 0;
    mockClient.isAuthenticated = false;
    mockClient.login.mockResolvedValue('auth-token');
    mockClient.getVersion.mockResolvedValue('7.0.0');

    await Prefs.load();
    await Prefs.addInstance({
      id: INSTANCE_ID,
      alias: 'Test',
      apiUrl: 'http://localhost:3000/api_jsonrpc.php',
      webUrl: 'http://localhost:3000',
      username: 'Admin',
      passwordEncrypted: '',
      savePassword: false,
      authMethod: ZabbixAuthMethod.PASSWORD,
      apiTokenEncrypted: '',
      saveApiToken: false,
      enabled: true,
    });
    await Prefs.update('environmentHostGroupRules', [
      { id: 'rule-1', hostGroupName: 'Dev servers', environmentId: 'development' },
    ]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits INVALID_LOGIN when password is missing', async () => {
    const service = new Service(delegate);
    await service.initializeConnection(undefined);
    expect(events.some((e) => e.event === ServiceEventType.INVALID_LOGIN)).toBe(true);
    service.shutdown();
  });

  it('connects and polls problems', async () => {
    vi.useFakeTimers();
    const service = new Service(delegate);
    await service.initializeConnection('zabbix');

    await vi.runOnlyPendingTimersAsync();

    mockClient.isAuthenticated = true;
    expect(ZabbixApiClient).toHaveBeenCalled();
    expect(events.some((e) => e.event === ServiceEventType.CONNECTING)).toBe(true);
    expect(events.some((e) => e.event === ServiceEventType.CONNECTED)).toBe(true);

    await vi.runOnlyPendingTimersAsync();

    expect(service.getProblems()).toHaveLength(1);
    expect(service.getProblems()[0].severity).toBe(ZabbixSeverity.HIGH);
    expect(service.getProblems()[0].environment).toBe('development');
    expect(service.getHosts()[0].environment).toBe('development');
    expect(events.some((e) => e.event === ServiceEventType.PROBLEMS_UPDATED)).toBe(true);

    service.shutdown();
  });

  it('handles auth errors during connect', async () => {
    mockClient.login.mockRejectedValueOnce(new AuthError('bad credentials'));
    const service = new Service(delegate);
    await service.initializeConnection('wrong');
    await new Promise((r) => setTimeout(r, 20));

    expect(events.some((e) => e.event === ServiceEventType.INVALID_LOGIN)).toBe(true);
    expect(service.getLastErrorMessage()?.status).toBe(RequestStatus.LOGIN_INVALID);
    service.shutdown();
  });

  it('schedules retry on network error', async () => {
    vi.useFakeTimers();
    mockClient.getVersion.mockRejectedValueOnce(new NetworkError('offline'));
    const service = new Service(delegate);
    await service.initializeConnection('zabbix');
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    expect(events.some((e) => e.event === ServiceEventType.CONNECT_ERR)).toBe(true);
    service.shutdown();
  });

  it('shutdown clears state', async () => {
    const service = new Service(delegate);
    await service.initializeConnection('zabbix');
    service.closeConnection();
    expect(service.isConnected()).toBe(false);
    expect(events.some((e) => e.event === ServiceEventType.DISCONNECTED)).toBe(true);
  });

  it('connects with API token auth', async () => {
    vi.useFakeTimers();
    await Prefs.updateInstance(INSTANCE_ID, {
      authMethod: ZabbixAuthMethod.API_TOKEN,
      saveApiToken: true,
    });
    await Prefs.saveApiToken(INSTANCE_ID, 'zabbix-api-token-demo');

    const service = new Service(delegate);
    await service.initializeConnection('zabbix-api-token-demo');
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();

    expect(mockClient.authenticateWithApiToken).toHaveBeenCalledWith('zabbix-api-token-demo');
    expect(service.getProblems()).toHaveLength(1);
    service.shutdown();
  });
});

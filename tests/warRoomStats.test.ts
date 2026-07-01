import { describe, expect, it } from 'vitest';
import {
  buildEnvironmentHostStats,
  buildEnvironmentProblemSlices,
  filterProblemsByPeriod,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '../src/warroom/utils/warRoomStats';
import type { InfraEnvironmentNode, ZabbixProblem } from '../src/types';
import { ZabbixSeverity } from '../src/types';

function problem(partial: Partial<ZabbixProblem>): ZabbixProblem {
  return {
    eventid: 'evt-1',
    clock: 1_700_000_000,
    name: 'Test',
    severity: ZabbixSeverity.HIGH,
    hostid: '101',
    instanceId: 'inst-1',
    environment: 'prod',
    acknowledged: false,
    ...partial,
  } as ZabbixProblem;
}

const infra: InfraEnvironmentNode[] = [
  {
    environment: 'prod',
    problemCount: 0,
    instances: [
      {
        instanceId: 'inst-1',
        alias: 'Z1',
        apiUrl: 'https://zabbix.example/api_jsonrpc.php',
        isConnected: true,
        problemCount: 0,
        hosts: [
          {
            hostid: '101',
            name: 'web-1',
            instanceId: 'inst-1',
            problemCount: 0,
            maxSeverity: ZabbixSeverity.NOT_CLASSIFIED,
            isFavorite: false,
          },
          {
            hostid: '102',
            name: 'web-2',
            instanceId: 'inst-1',
            problemCount: 0,
            maxSeverity: ZabbixSeverity.NOT_CLASSIFIED,
            isFavorite: false,
          },
        ],
      },
    ],
  },
  {
    environment: 'staging',
    problemCount: 0,
    instances: [
      {
        instanceId: 'inst-2',
        alias: 'Z2',
        apiUrl: 'https://zabbix-staging.example/api_jsonrpc.php',
        isConnected: true,
        problemCount: 0,
        hosts: [
          {
            hostid: '201',
            name: 'app-1',
            instanceId: 'inst-2',
            problemCount: 0,
            maxSeverity: ZabbixSeverity.NOT_CLASSIFIED,
            isFavorite: false,
          },
        ],
      },
    ],
  },
];

describe('warRoomStats', () => {
  it('filters problems by period', () => {
    const problems = [
      problem({ eventid: '1', clock: 100 }),
      problem({ eventid: '2', clock: 200 }),
      problem({ eventid: '3', clock: 300 }),
    ];
    expect(filterProblemsByPeriod(problems, 150, 250).map((p) => p.eventid)).toEqual(['2']);
  });

  it('builds host stats per environment', () => {
    const problems = [
      problem({ eventid: '1', hostid: '101', instanceId: 'inst-1', environment: 'prod' }),
      problem({ eventid: '2', hostid: '201', instanceId: 'inst-2', environment: 'staging' }),
    ];
    const stats = buildEnvironmentHostStats(infra, problems);
    expect(stats).toHaveLength(2);
    const prod = stats.find((s) => s.environmentId === 'prod')!;
    expect(prod.okHosts).toBe(1);
    expect(prod.errorHosts).toBe(1);
    expect(prod.problemCount).toBe(1);
  });

  it('builds problem slices by environment', () => {
    const problems = [
      problem({ eventid: '1', environment: 'prod' }),
      problem({ eventid: '2', environment: 'prod' }),
      problem({ eventid: '3', environment: 'staging' }),
    ];
    expect(buildEnvironmentProblemSlices(problems)).toEqual([
      { environmentId: 'prod', count: 2 },
      { environmentId: 'staging', count: 1 },
    ]);
  });

  it('round-trips datetime-local values', () => {
    const sec = fromDatetimeLocalValue('2024-06-15T14:30');
    expect(toDatetimeLocalValue(sec)).toBe('2024-06-15T14:30');
  });
});

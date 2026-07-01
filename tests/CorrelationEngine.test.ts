import { describe, it, expect } from 'vitest';
import { groupProblems, normalizeTriggerName, findCorrelatedOnHost } from '../src/modules/service/CorrelationEngine';
import { ZabbixSeverity } from '../src/types';
import type { ZabbixProblem } from '../src/types';

function problem(partial: Partial<ZabbixProblem> & { eventid: string; name: string }): ZabbixProblem {
  return {
    severity: ZabbixSeverity.HIGH,
    clock: 1000,
    acknowledged: false,
    objectid: 't1',
    hostid: 'h1',
    hostName: 'srv1',
    instanceId: 'i1',
    instanceAlias: 'Prod',
    environment: 'production',
    ...partial,
  };
}

describe('CorrelationEngine', () => {
  it('normalizes trigger names by stripping host suffix', () => {
    expect(normalizeTriggerName('High CPU on web-01')).toBe('high cpu');
    expect(normalizeTriggerName('Disk full (db-01)')).toBe('disk full');
  });

  it('groups problems with similar trigger names', () => {
    const problems = [
      problem({ eventid: '1', name: 'High CPU on web-01', hostid: 'h1', hostName: 'web-01' }),
      problem({ eventid: '2', name: 'High CPU on web-02', hostid: 'h2', hostName: 'web-02' }),
      problem({ eventid: '3', name: 'Disk full', hostid: 'h3', hostName: 'db-01' }),
    ];
    const groups = groupProblems(problems);
    expect(groups).toHaveLength(2);
    expect(groups[0].problems).toHaveLength(2);
    expect(groups[0].hostCount).toBe(2);
  });

  it('finds correlated problems on same host in time window', () => {
    const now = Math.floor(Date.now() / 1000);
    const problems = [
      problem({ eventid: '1', name: 'A', hostid: 'h1', clock: now - 100 }),
      problem({ eventid: '2', name: 'B', hostid: 'h1', clock: now - 50 }),
      problem({ eventid: '3', name: 'C', hostid: 'h2', clock: now - 50 }),
    ];
    const correlated = findCorrelatedOnHost(problems, 300);
    expect(correlated.size).toBe(1);
  });
});

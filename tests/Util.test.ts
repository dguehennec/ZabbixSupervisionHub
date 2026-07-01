import { describe, it, expect } from 'vitest';
import {
  normalizeApiUrl,
  getOriginUrl,
  computeProblemSummary,
  filterProblems,
  filterNewItemsById,
  filterProblemsByMinSeverity,
  filterProblemsByAcknowledged,
  safeJson,
  computeHeatmap,
  formatDuration,
  resolveEnvironmentFromHostGroups,
  buildInfrastructureTree,
} from '../src/modules/service/Util';
import { ZabbixSeverity } from '../src/types';
import type { ZabbixProblem, ZabbixHost, ControllerInfo } from '../src/types';

describe('Util', () => {
  it('normalizes API URL', () => {
    expect(normalizeApiUrl('https://zabbix.example.com')).toBe(
      'https://zabbix.example.com/api_jsonrpc.php',
    );
    expect(normalizeApiUrl('https://zabbix.example.com/api_jsonrpc.php')).toBe(
      'https://zabbix.example.com/api_jsonrpc.php',
    );
  });

  it('extracts origin from server URL', () => {
    expect(getOriginUrl('https://zabbix.example.com/api_jsonrpc.php')).toBe(
      'https://zabbix.example.com',
    );
    expect(getOriginUrl('invalid')).toBe('');
  });

  it('computes problem summary by severity', () => {
    const problems: ZabbixProblem[] = [
      {
        eventid: '1',
        name: 'Disk full',
        severity: ZabbixSeverity.DISASTER,
        clock: 1,
        acknowledged: false,
        objectid: 't1',
        hostid: 'h1',
        hostName: 'srv1',
        instanceId: 'i1',
        instanceAlias: 'Prod',
        environment: 'production',
      },
      {
        eventid: '2',
        name: 'High CPU',
        severity: ZabbixSeverity.HIGH,
        clock: 2,
        acknowledged: false,
        objectid: 't2',
        hostid: 'h2',
        hostName: 'srv2',
        instanceId: 'i1',
        instanceAlias: 'Prod',
        environment: 'production',
      },
    ];
    const summary = computeProblemSummary(problems);
    expect(summary.total).toBe(2);
    expect(summary.disaster).toBe(1);
    expect(summary.high).toBe(1);
  });

  it('filters problems by search, severity and instance', () => {
    const problems: ZabbixProblem[] = [
      {
        eventid: '1',
        name: 'MySQL down',
        severity: ZabbixSeverity.HIGH,
        clock: 1,
        acknowledged: false,
        objectid: 't1',
        hostid: 'h1',
        hostName: 'db-server',
        instanceId: 'i1',
        instanceAlias: 'Prod',
        environment: 'production',
      },
      {
        eventid: '2',
        name: 'Disk space',
        severity: ZabbixSeverity.WARNING,
        clock: 2,
        acknowledged: false,
        objectid: 't2',
        hostid: 'h2',
        hostName: 'app-server',
        instanceId: 'i2',
        instanceAlias: 'Staging',
        environment: 'staging',
      },
    ];

    const filtered = filterProblems(problems, {
      search: 'mysql',
      severities: [ZabbixSeverity.HIGH],
      instanceId: 'i1',
    });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].name).toBe('MySQL down');
  });

  it('sorts filtered problems newest first', () => {
    const problems: ZabbixProblem[] = [
      {
        eventid: '1',
        name: 'Old',
        severity: ZabbixSeverity.DISASTER,
        clock: 100,
        acknowledged: false,
        objectid: 't1',
        hostid: 'h1',
        hostName: 'a',
        instanceId: 'i1',
        instanceAlias: 'P',
        environment: 'production',
      },
      {
        eventid: '2',
        name: 'Recent',
        severity: ZabbixSeverity.INFORMATION,
        clock: 200,
        acknowledged: false,
        objectid: 't2',
        hostid: 'h2',
        hostName: 'b',
        instanceId: 'i1',
        instanceAlias: 'P',
        environment: 'production',
      },
    ];
    const sorted = filterProblems(problems, {});
    expect(sorted[0].name).toBe('Recent');
    expect(sorted[1].name).toBe('Old');
  });

  it('detects new items by id', () => {
    const prev = [{ eventid: '1', name: 'a' }];
    const incoming = [
      { eventid: '1', name: 'a' },
      { eventid: '2', name: 'b' },
    ];
    expect(filterNewItemsById(prev, incoming, 'eventid')).toHaveLength(1);
  });

  it('safeJson returns null on invalid JSON', () => {
    expect(safeJson('{bad')).toBeNull();
    expect(safeJson('{"ok":true}')).toEqual({ ok: true });
  });

  it('computes heatmap cells from problems', () => {
    const problems: ZabbixProblem[] = [
      {
        eventid: '1',
        name: 'CPU high',
        severity: ZabbixSeverity.HIGH,
        clock: 1,
        acknowledged: false,
        objectid: 't1',
        hostid: 'h1',
        hostName: 'web-01',
        instanceId: 'i1',
        instanceAlias: 'Prod',
        environment: 'production',
      },
    ];
    const cells = computeHeatmap(problems, []);
    expect(cells).toHaveLength(1);
    expect(cells[0].total).toBe(1);
    expect(cells[0].counts[ZabbixSeverity.HIGH]).toBe(1);
  });

  it('formats duration from clock', () => {
    const clock = Math.floor(Date.now() / 1000) - 120;
    expect(formatDuration(clock)).toMatch(/2m/);
  });

  it('filters problems by minimum severity', () => {
    const problems: ZabbixProblem[] = [
      {
        eventid: '1',
        name: 'Info',
        severity: ZabbixSeverity.INFORMATION,
        clock: 1,
        acknowledged: false,
        objectid: 't1',
        hostid: 'h1',
        hostName: 'srv1',
        instanceId: 'i1',
        instanceAlias: 'Prod',
        environment: 'production',
      },
      {
        eventid: '2',
        name: 'High CPU',
        severity: ZabbixSeverity.HIGH,
        clock: 2,
        acknowledged: false,
        objectid: 't2',
        hostid: 'h2',
        hostName: 'srv2',
        instanceId: 'i1',
        instanceAlias: 'Prod',
        environment: 'production',
      },
    ];

    expect(filterProblemsByMinSeverity(problems, ZabbixSeverity.HIGH)).toHaveLength(1);
    expect(filterProblemsByMinSeverity(problems, ZabbixSeverity.NOT_CLASSIFIED)).toHaveLength(2);
    expect(filterProblemsByMinSeverity(problems, ZabbixSeverity.AVERAGE)).toHaveLength(1);
  });

  it('filters acknowledged problems when hideAcknowledged is enabled', () => {
    const problems: ZabbixProblem[] = [
      {
        eventid: '1',
        name: 'Open',
        severity: ZabbixSeverity.HIGH,
        clock: 1,
        acknowledged: false,
        objectid: 't1',
        hostid: 'h1',
        hostName: 'srv1',
        instanceId: 'i1',
        instanceAlias: 'Prod',
        environment: 'production',
      },
      {
        eventid: '2',
        name: 'Closed',
        severity: ZabbixSeverity.HIGH,
        clock: 2,
        acknowledged: true,
        objectid: 't2',
        hostid: 'h2',
        hostName: 'srv2',
        instanceId: 'i1',
        instanceAlias: 'Prod',
        environment: 'production',
      },
    ];
    expect(filterProblemsByAcknowledged(problems, false)).toHaveLength(2);
    expect(filterProblemsByAcknowledged(problems, true)).toHaveLength(1);
    expect(filterProblemsByAcknowledged(problems, true)[0].eventid).toBe('1');
  });

  it('resolves environment from host groups with first matching rule', () => {
    const rules = [
      { id: '1', hostGroupName: 'Production', environmentId: 'production' },
      { id: '2', hostGroupName: 'Staging', environmentId: 'staging' },
    ];
    expect(resolveEnvironmentFromHostGroups(['Staging', 'Linux'], rules)).toBe('staging');
    expect(resolveEnvironmentFromHostGroups(['Unknown group'], rules)).toBe('other');
    expect(resolveEnvironmentFromHostGroups(['production'], rules)).toBe('production');
  });

  it('builds infrastructure tree by host environment', () => {
    const controllers: ControllerInfo[] = [
      {
        id: 'c1',
        instanceId: 'i1',
        instanceAlias: 'Prod Zabbix',
        instanceApiUrl: 'https://zabbix.example.com',
        isConnected: true,
        isConnecting: false,
        problemCount: 0,
        disasterCount: 0,
        highCount: 0,
        problems: [],
        lastErrorMessage: null,
        zabbixVersion: '7.2.0',
      },
    ];
    const hosts: ZabbixHost[] = [
      {
        hostid: 'h1',
        name: 'web-01',
        status: 0,
        instanceId: 'i1',
        groupIds: ['1'],
        groupNames: ['Production'],
        environment: 'production',
      },
      {
        hostid: 'h2',
        name: 'dev-01',
        status: 0,
        instanceId: 'i1',
        groupIds: ['2'],
        groupNames: ['Misc'],
        environment: 'other',
      },
    ];
    const problems: ZabbixProblem[] = [
      {
        eventid: '1',
        name: 'CPU',
        severity: ZabbixSeverity.HIGH,
        clock: 1,
        acknowledged: false,
        objectid: 't1',
        hostid: 'h1',
        hostName: 'web-01',
        instanceId: 'i1',
        instanceAlias: 'Prod Zabbix',
        environment: 'production',
      },
    ];

    const environments = [
      { id: 'production', label: 'Production', builtin: false, hidden: false },
      { id: 'other', label: 'Autre', builtin: true, hidden: false },
      { id: 'hide', label: 'Cacher', builtin: true, hidden: true },
    ];
    const tree = buildInfrastructureTree(problems, hosts, controllers, [], environments);
    expect(tree).toHaveLength(2);
    expect(tree[0].environment).toBe('production');
    expect(tree[0].instances[0].hosts).toHaveLength(1);
    expect(tree.find((n) => n.environment === 'other')?.instances[0].hosts).toHaveLength(1);
  });
});

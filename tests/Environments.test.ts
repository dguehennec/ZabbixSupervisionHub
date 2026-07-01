import { describe, it, expect } from 'vitest';
import {
  BUILTIN_ENVIRONMENT_IDS,
  defaultEnvironments,
  filterProblemsByHiddenEnvironment,
  migrateEnvironmentPrefs,
  normalizeEnvironments,
  resolveEnvironmentFromHostGroups,
  slugifyEnvironmentId,
} from '../src/modules/service/Environments';
import { ZabbixSeverity } from '../src/types';
import type { ZabbixProblem } from '../src/types';

describe('Environments', () => {
  it('keeps built-in Other and Hide in normalized list', () => {
    const envs = normalizeEnvironments([
      { id: 'prod', label: 'Production', builtin: false, hidden: false },
    ]);
    expect(envs.some((e) => e.id === BUILTIN_ENVIRONMENT_IDS.OTHER)).toBe(true);
    expect(envs.some((e) => e.id === BUILTIN_ENVIRONMENT_IDS.HIDE)).toBe(true);
    expect(envs[0].id).toBe('prod');
  });

  it('filters problems in hidden environment', () => {
    const environments = defaultEnvironments();
    const problems: ZabbixProblem[] = [
      {
        eventid: '1',
        name: 'Visible',
        severity: ZabbixSeverity.HIGH,
        clock: 1,
        acknowledged: false,
        objectid: 't1',
        hostid: 'h1',
        hostName: 'srv',
        instanceId: 'i1',
        instanceAlias: 'Z',
        environment: BUILTIN_ENVIRONMENT_IDS.OTHER,
      },
      {
        eventid: '2',
        name: 'Hidden',
        severity: ZabbixSeverity.HIGH,
        clock: 2,
        acknowledged: false,
        objectid: 't2',
        hostid: 'h2',
        hostName: 'srv2',
        instanceId: 'i1',
        instanceAlias: 'Z',
        environment: BUILTIN_ENVIRONMENT_IDS.HIDE,
      },
    ];
    const visible = filterProblemsByHiddenEnvironment(problems, environments);
    expect(visible).toHaveLength(1);
    expect(visible[0].eventid).toBe('1');
  });

  it('migrates legacy environment rules to custom definitions', () => {
    const migrated = migrateEnvironmentPrefs({
      environmentHostGroupRules: [
        { id: '1', hostGroupName: 'Prod', environment: 'production' } as never,
      ],
    });
    expect(migrated.environments.some((e) => e.id === 'production')).toBe(true);
    expect(migrated.rules[0].environmentId).toBe('production');
  });

  it('creates unique slug ids', () => {
    const ids = new Set(['prod']);
    expect(slugifyEnvironmentId('Prod', ids)).toBe('prod_2');
  });

  it('supports legacy rule.environment field', () => {
    const rules = [{ id: '1', hostGroupName: 'Prod', environment: 'production' } as never];
    expect(resolveEnvironmentFromHostGroups(['Prod'], rules)).toBe('production');
  });
});

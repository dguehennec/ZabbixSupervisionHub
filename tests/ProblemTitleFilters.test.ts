import { describe, it, expect } from 'vitest';
import {
  compileTitleHidePattern,
  filterProblemsByTitleHideRules,
  isInvalidTitleHidePattern,
  isProblemHiddenByTitleRules,
  normalizeTitleHideRules,
} from '../src/modules/service/ProblemTitleFilters';
import { ZabbixSeverity } from '../src/types';
import type { ZabbixProblem } from '../src/types';

const sampleProblem = (name: string): ZabbixProblem => ({
  eventid: '1',
  name,
  severity: ZabbixSeverity.HIGH,
  clock: 1,
  acknowledged: false,
  objectid: 't1',
  hostid: 'h1',
  hostName: 'srv',
  instanceId: 'i1',
  instanceAlias: 'Z',
  environment: 'other',
});

describe('ProblemTitleFilters', () => {
  it('normalizes and drops empty patterns', () => {
    expect(
      normalizeTitleHideRules([
        { id: '1', pattern: '  backup  ' },
        { id: '2', pattern: '   ' },
      ]),
    ).toEqual([{ id: '1', pattern: 'backup' }]);
  });

  it('detects invalid regex patterns', () => {
    expect(isInvalidTitleHidePattern('backup')).toBe(false);
    expect(isInvalidTitleHidePattern('(')).toBe(true);
    expect(isInvalidTitleHidePattern('')).toBe(false);
  });

  it('filters problems by title regex case-insensitively', () => {
    const problems = [
      sampleProblem('Disk full on /var'),
      sampleProblem('Backup job failed'),
      sampleProblem('CPU high'),
    ];
    const rules = [{ id: '1', pattern: 'backup' }];
    const visible = filterProblemsByTitleHideRules(problems, rules);
    expect(visible).toHaveLength(2);
    expect(visible.map((p) => p.name)).toEqual(['Disk full on /var', 'CPU high']);
  });

  it('supports anchored regex patterns', () => {
    const problem = sampleProblem('Disk full');
    expect(
      isProblemHiddenByTitleRules(problem, [{ id: '1', pattern: '^Disk full$' }]),
    ).toBe(true);
    expect(
      isProblemHiddenByTitleRules(problem, [{ id: '1', pattern: '^CPU' }]),
    ).toBe(false);
  });

  it('ignores invalid patterns when filtering', () => {
    const problems = [sampleProblem('test alert')];
    const visible = filterProblemsByTitleHideRules(problems, [{ id: '1', pattern: '(' }]);
    expect(visible).toHaveLength(1);
    expect(compileTitleHidePattern('(')).toBeNull();
  });
});

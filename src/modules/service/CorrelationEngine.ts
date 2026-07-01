// ============================================================
// modules/service/CorrelationEngine.ts — Problem grouping & correlation
// ============================================================

import type { ProblemGroup, ZabbixProblem } from '../../types';

/** Normalize trigger name by stripping host-specific suffixes. */
export function normalizeTriggerName(name: string): string {
  return name
    .replace(/\s+on\s+[\w.-]+$/i, '')
    .replace(/\s*\([\w.-]+\)\s*$/, '')
    .replace(/\s+-\s+[\w.-]+$/i, '')
    .trim()
    .toLowerCase();
}

/** Group problems by similar trigger name (correlation by pattern). */
export function groupProblems(problems: ZabbixProblem[]): ProblemGroup[] {
  const map = new Map<string, ProblemGroup>();

  for (const problem of problems) {
    const key = normalizeTriggerName(problem.name);
    let group = map.get(key);
    if (!group) {
      group = {
        key,
        name: problem.name,
        severity: problem.severity,
        problems: [],
        hostCount: 0,
        instanceIds: [],
      };
      map.set(key, group);
    }
    group.problems.push(problem);
    if (problem.severity > group.severity) {
      group.severity = problem.severity;
      group.name = problem.name;
    }
  }

  return Array.from(map.values())
    .map((group) => ({
      ...group,
      hostCount: new Set(group.problems.map((p) => `${p.instanceId}:${p.hostid}`)).size,
      instanceIds: [...new Set(group.problems.map((p) => p.instanceId))],
    }))
    .sort(
      (a, b) =>
        b.severity - a.severity ||
        b.problems.length - a.problems.length ||
        b.hostCount - a.hostCount,
    );
}

/** Detect correlated problems on the same host within a time window (seconds). */
export function findCorrelatedOnHost(
  problems: ZabbixProblem[],
  windowSec = 300,
): Map<string, ZabbixProblem[]> {
  const byHost = new Map<string, ZabbixProblem[]>();
  for (const p of problems) {
    const key = `${p.instanceId}:${p.hostid}`;
    const list = byHost.get(key) ?? [];
    list.push(p);
    byHost.set(key, list);
  }

  const correlated = new Map<string, ZabbixProblem[]>();
  for (const [key, hostProblems] of byHost) {
    if (hostProblems.length < 2) continue;
    const sorted = [...hostProblems].sort((a, b) => a.clock - b.clock);
    const clusters: ZabbixProblem[][] = [];
    let cluster: ZabbixProblem[] = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].clock - cluster[cluster.length - 1].clock <= windowSec) {
        cluster.push(sorted[i]);
      } else {
        if (cluster.length > 1) clusters.push(cluster);
        cluster = [sorted[i]];
      }
    }
    if (cluster.length > 1) clusters.push(cluster);

    for (const c of clusters) {
      correlated.set(`${key}:${c[0].eventid}`, c);
    }
  }
  return correlated;
}

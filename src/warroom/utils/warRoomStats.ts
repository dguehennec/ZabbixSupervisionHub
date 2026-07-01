import type { InfraEnvironmentNode, ZabbixProblem } from '../../types';
import { ZabbixSeverity } from '../../types';

export const DEFAULT_WARROOM_PERIOD_SEC = 6 * 3600;

export interface EnvironmentHostStats {
  environmentId: string;
  okHosts: number;
  errorHosts: number;
  problemCount: number;
  hosts: EnvironmentHostNode[];
}

export interface EnvironmentHostNode {
  key: string;
  hostName: string;
  instanceAlias: string;
  hasError: boolean;
  problemCount: number;
  maxSeverity: ZabbixSeverity;
}

export interface EnvironmentProblemSlice {
  environmentId: string;
  count: number;
}

const CHART_COLORS = [
  '#38bdf8',
  '#a78bfa',
  '#f472b6',
  '#fb923c',
  '#4ade80',
  '#facc15',
  '#94a3b8',
  '#f87171',
];

export function environmentChartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

export function filterProblemsByPeriod(
  problems: ZabbixProblem[],
  timeStartSec: number,
  timeEndSec: number,
): ZabbixProblem[] {
  return problems.filter((p) => p.clock >= timeStartSec && p.clock <= timeEndSec);
}

export function buildEnvironmentHostStats(
  infra: InfraEnvironmentNode[],
  filteredProblems: ZabbixProblem[],
): EnvironmentHostStats[] {
  const problemsByHost = new Map<string, ZabbixProblem[]>();
  for (const p of filteredProblems) {
    const key = `${p.instanceId}:${p.hostid}`;
    const list = problemsByHost.get(key) ?? [];
    list.push(p);
    problemsByHost.set(key, list);
  }

  const stats: EnvironmentHostStats[] = [];

  for (const envNode of infra) {
    const hosts: EnvironmentHostNode[] = [];
    let okHosts = 0;
    let errorHosts = 0;
    let problemCount = 0;

    for (const inst of envNode.instances) {
      for (const h of inst.hosts) {
        const key = `${h.instanceId}:${h.hostid}`;
        const hostProblems = problemsByHost.get(key) ?? [];
        const hasError = hostProblems.length > 0;
        const maxSeverity = hasError
          ? hostProblems.reduce(
              (max, p) => (p.severity > max ? p.severity : max),
              ZabbixSeverity.NOT_CLASSIFIED,
            )
          : ZabbixSeverity.NOT_CLASSIFIED;

        if (hasError) {
          errorHosts++;
          problemCount += hostProblems.length;
        } else {
          okHosts++;
        }

        hosts.push({
          key,
          hostName: h.name,
          instanceAlias: inst.alias,
          hasError,
          problemCount: hostProblems.length,
          maxSeverity,
        });
      }
    }

    stats.push({
      environmentId: envNode.environment,
      okHosts,
      errorHosts,
      problemCount,
      hosts,
    });
  }

  return stats;
}

export function buildEnvironmentProblemSlices(
  filteredProblems: ZabbixProblem[],
): EnvironmentProblemSlice[] {
  const counts = new Map<string, number>();
  for (const p of filteredProblems) {
    const env = p.environment || 'other';
    counts.set(env, (counts.get(env) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([environmentId, count]) => ({ environmentId, count }))
    .sort((a, b) => b.count - a.count || a.environmentId.localeCompare(b.environmentId));
}

export function toDatetimeLocalValue(unixSec: number): string {
  const d = new Date(unixSec * 1000);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDatetimeLocalValue(value: string): number {
  return Math.floor(new Date(value).getTime() / 1000);
}

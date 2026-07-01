// ============================================================
// modules/service/Util.ts
// ============================================================

import { Constants } from '../constant/constants';
import {
  NetworkError,
  ZabbixSeverity,
  ZabbixProblem,
  ProblemSummary,
  HeatmapCell,
  InfraEnvironmentNode,
  ControllerInfo,
  ZabbixHost,
  EnvironmentDefinition,
  ProblemTitleHideRule,
} from '../../types';
import {
  BUILTIN_ENVIRONMENT_IDS,
  defaultEnvironments,
  filterProblemsByHiddenEnvironment,
  isHiddenEnvironment,
  resolveEnvironmentFromHostGroups,
} from './Environments';
import { filterProblemsByTitleHideRules } from './ProblemTitleFilters';

export { resolveEnvironmentFromHostGroups } from './Environments';

export function i18n(key: string, ...subs: string[]): string {
  try {
    return chrome.i18n.getMessage(key, subs) || key;
  } catch {
    return key;
  }
}

export function randomHex(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function buildInfrastructureTree(
  problems: ZabbixProblem[],
  hosts: ZabbixHost[],
  controllers: ControllerInfo[],
  favoriteHostIds: string[] = [],
  environments: EnvironmentDefinition[] = defaultEnvironments(),
): InfraEnvironmentNode[] {
  const favorites = new Set(favoriteHostIds);
  const problemByHost = new Map<string, ZabbixProblem[]>();

  for (const p of problems) {
    const key = `${p.instanceId}:${p.hostid}`;
    const list = problemByHost.get(key) ?? [];
    list.push(p);
    problemByHost.set(key, list);
  }

  const envMap = new Map<string, InfraEnvironmentNode>();

  for (const ctrl of controllers) {
    const instanceHosts = hosts.filter((h) => h.instanceId === ctrl.instanceId);
    for (const h of instanceHosts) {
      if (isHiddenEnvironment(h.environment, environments)) continue;

      const env = h.environment ?? BUILTIN_ENVIRONMENT_IDS.OTHER;
      let envNode = envMap.get(env);
      if (!envNode) {
        envNode = { environment: env, instances: [], problemCount: 0 };
        envMap.set(env, envNode);
      }

      let instanceNode = envNode.instances.find((i) => i.instanceId === ctrl.instanceId);
      if (!instanceNode) {
        instanceNode = {
          instanceId: ctrl.instanceId,
          alias: ctrl.instanceAlias || ctrl.instanceApiUrl,
          apiUrl: ctrl.instanceApiUrl,
          isConnected: ctrl.isConnected,
          hosts: [],
          problemCount: 0,
        };
        envNode.instances.push(instanceNode);
      }

      const key = `${h.instanceId}:${h.hostid}`;
      const hostProblems = problemByHost.get(key) ?? [];
      const maxSeverity =
        hostProblems.length > 0
          ? hostProblems.reduce(
              (max, p) => (p.severity > max ? p.severity : max),
              ZabbixSeverity.NOT_CLASSIFIED,
            )
          : ZabbixSeverity.NOT_CLASSIFIED;

      instanceNode.hosts.push({
        hostid: h.hostid,
        name: h.name,
        instanceId: h.instanceId,
        problemCount: hostProblems.length,
        maxSeverity,
        isFavorite: favorites.has(key),
      });
      instanceNode.problemCount += hostProblems.length;
      envNode.problemCount += hostProblems.length;
    }
  }

  for (const envNode of envMap.values()) {
    for (const inst of envNode.instances) {
      inst.hosts.sort((a, b) => b.problemCount - a.problemCount || a.name.localeCompare(b.name));
    }
    envNode.instances.sort(
      (a, b) => b.problemCount - a.problemCount || a.alias.localeCompare(b.alias),
    );
  }

  const order = environments.filter((e) => !e.hidden).map((e) => e.id);

  return order
    .filter((env) => envMap.has(env))
    .map((env) => envMap.get(env)!)
    .concat(
      [...envMap.keys()]
        .filter((e) => !order.includes(e))
        .map((e) => envMap.get(e)!),
    );
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getOriginUrl(serverUrl: string): string {
  try {
    const url = new URL(serverUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    if (!url.origin || url.origin === 'null') return '';
    return url.origin;
  } catch {
    return '';
  }
}

export function normalizeApiUrl(serverUrl: string): string {
  const trimmed = serverUrl.trim().replace(/\/+$/, '');
  if (trimmed.endsWith('/api_jsonrpc.php')) return trimmed;
  return `${trimmed}/api_jsonrpc.php`;
}

export async function requestOriginPermission(serverUrl: string): Promise<boolean> {
  const origin = getOriginUrl(serverUrl);
  if (!origin) return false;
  try {
    return await chrome.permissions.request({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

export async function checkOriginPermission(serverUrl: string): Promise<boolean> {
  const origin = getOriginUrl(serverUrl);
  if (!origin) return false;
  try {
    return await chrome.permissions.contains({ origins: [`${origin}/*`] });
  } catch {
    return false;
  }
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: {
    maxAttempts?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    jitterMs?: number;
    shouldRetry?: (err: unknown) => boolean;
  } = {},
): Promise<T> {
  const {
    maxAttempts = Constants.RETRY.MAX_ATTEMPTS,
    baseDelayMs = Constants.RETRY.BASE_DELAY_MS,
    maxDelayMs = Constants.RETRY.MAX_DELAY_MS,
    factor = Constants.RETRY.BACKOFF_FACTOR,
    jitterMs = Constants.RETRY.JITTER_MS,
    shouldRetry = (e) => e instanceof NetworkError && e.retriable,
  } = opts;

  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt++;
      if (attempt >= maxAttempts || !shouldRetry(err)) throw err;
      const base = Math.min(baseDelayMs * Math.pow(factor, attempt - 1), maxDelayMs);
      await sleep(base + Math.random() * jitterMs);
    }
  }
}

export function filterNewItemsById<T extends { eventid?: string; id?: string }>(
  previous: T[],
  incoming: T[],
  idKey: 'eventid' | 'id' = 'eventid',
): T[] {
  const oldIds = new Set(previous.map((item) => (item as Record<string, string>)[idKey]));
  return incoming.filter((item) => !oldIds.has((item as Record<string, string>)[idKey]));
}

export function safeJson<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export function severityLabel(severity: ZabbixSeverity): string {
  const keys: Record<ZabbixSeverity, string> = {
    [ZabbixSeverity.NOT_CLASSIFIED]: 'severity_not_classified',
    [ZabbixSeverity.INFORMATION]: 'severity_information',
    [ZabbixSeverity.WARNING]: 'severity_warning',
    [ZabbixSeverity.AVERAGE]: 'severity_average',
    [ZabbixSeverity.HIGH]: 'severity_high',
    [ZabbixSeverity.DISASTER]: 'severity_disaster',
  };
  return i18n(keys[severity]);
}

export function severityColorClass(severity: ZabbixSeverity): string {
  const map: Record<ZabbixSeverity, string> = {
    [ZabbixSeverity.NOT_CLASSIFIED]: 'text-gray-400',
    [ZabbixSeverity.INFORMATION]: 'text-zabbix-info',
    [ZabbixSeverity.WARNING]: 'text-zabbix-warning',
    [ZabbixSeverity.AVERAGE]: 'text-zabbix-average',
    [ZabbixSeverity.HIGH]: 'text-zabbix-high',
    [ZabbixSeverity.DISASTER]: 'text-zabbix-disaster',
  };
  return map[severity];
}

export function computeProblemSummary(problems: ZabbixProblem[]): ProblemSummary {
  const summary: ProblemSummary = {
    total: problems.length,
    disaster: 0,
    high: 0,
    average: 0,
    warning: 0,
    information: 0,
    notClassified: 0,
  };
  for (const p of problems) {
    switch (p.severity) {
      case ZabbixSeverity.DISASTER:
        summary.disaster++;
        break;
      case ZabbixSeverity.HIGH:
        summary.high++;
        break;
      case ZabbixSeverity.AVERAGE:
        summary.average++;
        break;
      case ZabbixSeverity.WARNING:
        summary.warning++;
        break;
      case ZabbixSeverity.INFORMATION:
        summary.information++;
        break;
      default:
        summary.notClassified++;
    }
  }
  return summary;
}

export function filterProblems(
  problems: ZabbixProblem[],
  opts: {
    search?: string;
    severities?: ZabbixSeverity[];
    environment?: string;
    instanceId?: string;
    acknowledgedOnly?: boolean;
    unacknowledgedOnly?: boolean;
  },
): ZabbixProblem[] {
  let result = [...problems];
  if (opts.instanceId) {
    result = result.filter((p) => p.instanceId === opts.instanceId);
  }
  if (opts.environment) {
    result = result.filter((p) => p.environment === opts.environment);
  }
  if (opts.severities?.length) {
    const set = new Set(opts.severities);
    result = result.filter((p) => set.has(p.severity));
  }
  if (opts.acknowledgedOnly) {
    result = result.filter((p) => p.acknowledged);
  }
  if (opts.unacknowledgedOnly) {
    result = result.filter((p) => !p.acknowledged);
  }
  const search = opts.search?.trim().toLowerCase();
  if (search) {
    result = result.filter(
      (p) =>
        p.name.toLowerCase().includes(search) ||
        p.hostName.toLowerCase().includes(search) ||
        p.instanceAlias.toLowerCase().includes(search),
    );
  }
  return result.sort((a, b) => b.clock - a.clock);
}

export function formatDuration(clock: number): string {
  const sec = Math.max(0, Math.floor(Date.now() / 1000) - clock);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
}

export function emptySeverityCounts(): Record<ZabbixSeverity, number> {
  return {
    [ZabbixSeverity.NOT_CLASSIFIED]: 0,
    [ZabbixSeverity.INFORMATION]: 0,
    [ZabbixSeverity.WARNING]: 0,
    [ZabbixSeverity.AVERAGE]: 0,
    [ZabbixSeverity.HIGH]: 0,
    [ZabbixSeverity.DISASTER]: 0,
  };
}

export function computeHeatmap(problems: ZabbixProblem[], hosts: ZabbixHost[]): HeatmapCell[] {
  const hostNames = new Map(hosts.map((h) => [`${h.instanceId}:${h.hostid}`, h.name]));
  const aliasByInstance = new Map<string, string>();
  for (const p of problems) {
    if (p.instanceAlias) aliasByInstance.set(p.instanceId, p.instanceAlias);
  }

  const cells = new Map<string, HeatmapCell>();
  for (const p of problems) {
    const key = `${p.instanceId}:${p.hostid}`;
    let cell = cells.get(key);
    if (!cell) {
      cell = {
        hostid: p.hostid,
        hostName: p.hostName || hostNames.get(key) || p.hostid,
        instanceId: p.instanceId,
        instanceAlias: p.instanceAlias || aliasByInstance.get(p.instanceId) || '',
        counts: emptySeverityCounts(),
        maxSeverity: ZabbixSeverity.NOT_CLASSIFIED,
        total: 0,
      };
      cells.set(key, cell);
    }
    cell.counts[p.severity]++;
    cell.total++;
    if (p.severity > cell.maxSeverity) cell.maxSeverity = p.severity;
  }

  return Array.from(cells.values()).sort(
    (a, b) => b.maxSeverity - a.maxSeverity || b.total - a.total || a.hostName.localeCompare(b.hostName),
  );
}

export function formatClock(clock: number): string {
  return new Date(clock * 1000).toLocaleString();
}

export function filterProblemsBySnooze(
  problems: ZabbixProblem[],
  snoozedKeys: Set<string>,
): ZabbixProblem[] {
  if (!snoozedKeys.size) return problems;
  return problems.filter((p) => !snoozedKeys.has(`${p.instanceId}:${p.eventid}`));
}

export function filterProblemsByMinSeverity(
  problems: ZabbixProblem[],
  minSeverity: ZabbixSeverity,
): ZabbixProblem[] {
  return problems.filter((p) => p.severity >= minSeverity);
}

export function filterProblemsByAcknowledged(
  problems: ZabbixProblem[],
  hideAcknowledged: boolean,
): ZabbixProblem[] {
  if (!hideAcknowledged) return problems;
  return problems.filter((p) => !p.acknowledged);
}

export function applyProblemVisibilityToControllerInfo(
  info: ControllerInfo,
  minSeverity: ZabbixSeverity,
  snoozedKeys: Set<string>,
  hideSnoozed: boolean,
  environments: EnvironmentDefinition[] = defaultEnvironments(),
  titleHideRules: ProblemTitleHideRule[] = [],
  hideAcknowledged = false,
): ControllerInfo {
  let problems = filterProblemsByMinSeverity(info.problems, minSeverity);
  problems = filterProblemsByHiddenEnvironment(problems, environments);
  problems = filterProblemsByTitleHideRules(problems, titleHideRules);
  problems = filterProblemsByAcknowledged(problems, hideAcknowledged);
  if (hideSnoozed) {
    problems = filterProblemsBySnooze(problems, snoozedKeys);
  }
  return {
    ...info,
    problems,
    problemCount: problems.length,
    disasterCount: problems.filter((p) => p.severity === ZabbixSeverity.DISASTER).length,
    highCount: problems.filter((p) => p.severity === ZabbixSeverity.HIGH).length,
  };
}

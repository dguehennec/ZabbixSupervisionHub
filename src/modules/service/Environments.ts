// ============================================================
// modules/service/Environments.ts — Configurable environment labels
// ============================================================

import type {
  EnvironmentDefinition,
  EnvironmentHostGroupRule,
  ZabbixProblem,
} from '../../types';
import { Constants } from '../constant/constants';

export const BUILTIN_ENVIRONMENT_IDS = Constants.BUILTIN_ENVIRONMENT_IDS;

function envI18n(key: string): string {
  try {
    return chrome.i18n.getMessage(key) || key;
  } catch {
    return key;
  }
}

export function defaultEnvironments(): EnvironmentDefinition[] {
  return Constants.DEFAULT_ENVIRONMENTS.map((env) => ({ ...env }));
}

/** Ensure built-in Other/Hide exist; preserve custom environment order. */
export function normalizeEnvironments(list?: EnvironmentDefinition[]): EnvironmentDefinition[] {
  const byId = new Map<string, EnvironmentDefinition>();
  for (const builtin of Constants.DEFAULT_ENVIRONMENTS) {
    byId.set(builtin.id, { ...builtin });
  }
  for (const env of list ?? []) {
    if (!env?.id) continue;
    const builtin = byId.get(env.id);
    if (builtin?.builtin) {
      byId.set(env.id, {
        ...builtin,
        label: env.label?.trim() || builtin.label,
      });
    } else {
      byId.set(env.id, {
        id: env.id,
        label: env.label?.trim() || env.id,
        builtin: false,
        hidden: env.hidden === true,
      });
    }
  }

  const custom: EnvironmentDefinition[] = [];
  for (const env of list ?? []) {
    if (!env?.id || byId.get(env.id)?.builtin) continue;
    if (custom.some((e) => e.id === env.id)) continue;
    custom.push(byId.get(env.id)!);
  }

  return [
    ...custom,
    byId.get(BUILTIN_ENVIRONMENT_IDS.OTHER)!,
    byId.get(BUILTIN_ENVIRONMENT_IDS.HIDE)!,
  ];
}

export function slugifyEnvironmentId(label: string, existingIds: Set<string>): string {
  const base =
    label
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_|_$/g, '') || 'env';
  let id = base;
  let n = 2;
  while (
    existingIds.has(id) ||
    id === BUILTIN_ENVIRONMENT_IDS.OTHER ||
    id === BUILTIN_ENVIRONMENT_IDS.HIDE
  ) {
    id = `${base}_${n++}`;
  }
  return id;
}

export function environmentLabel(env: EnvironmentDefinition): string {
  if (env.id === BUILTIN_ENVIRONMENT_IDS.OTHER) {
    return envI18n('env_builtin_other');
  }
  if (env.id === BUILTIN_ENVIRONMENT_IDS.HIDE) {
    return envI18n('env_builtin_hide');
  }
  return env.label;
}

export function environmentLabelById(
  id: string,
  environments: EnvironmentDefinition[],
): string {
  const env = environments.find((e) => e.id === id);
  return env ? environmentLabel(env) : id;
}

export function isHiddenEnvironment(
  environmentId: string,
  environments: EnvironmentDefinition[],
): boolean {
  if (environmentId === BUILTIN_ENVIRONMENT_IDS.HIDE) return true;
  const env = environments.find((e) => e.id === environmentId);
  return env?.hidden === true;
}

export function visibleEnvironments(
  environments: EnvironmentDefinition[],
): EnvironmentDefinition[] {
  return environments.filter((e) => !e.hidden);
}

export function filterProblemsByHiddenEnvironment(
  problems: ZabbixProblem[],
  environments: EnvironmentDefinition[],
): ZabbixProblem[] {
  return problems.filter((p) => !isHiddenEnvironment(p.environment, environments));
}

export function normalizeEnvironmentRule(
  rule: EnvironmentHostGroupRule & { environment?: string },
): EnvironmentHostGroupRule {
  return {
    id: rule.id,
    hostGroupName: rule.hostGroupName,
    environmentId: rule.environmentId ?? rule.environment ?? BUILTIN_ENVIRONMENT_IDS.OTHER,
  };
}

export function normalizeEnvironmentRules(
  rules?: Array<EnvironmentHostGroupRule & { environment?: string }>,
): EnvironmentHostGroupRule[] {
  return (rules ?? []).map(normalizeEnvironmentRule);
}

export function sanitizeEnvironmentRules(
  rules: EnvironmentHostGroupRule[],
  environments: EnvironmentDefinition[],
): EnvironmentHostGroupRule[] {
  const envIds = new Set(environments.map((e) => e.id));
  return rules.map((rule) => ({
    ...rule,
    environmentId: envIds.has(rule.environmentId)
      ? rule.environmentId
      : BUILTIN_ENVIRONMENT_IDS.OTHER,
  }));
}

/** Map Zabbix host group names to an environment using configured rules (first match wins). */
export function resolveEnvironmentFromHostGroups(
  groupNames: string[],
  rules: EnvironmentHostGroupRule[],
): string {
  const normalizedGroups = new Set(groupNames.map((g) => g.trim().toLowerCase()).filter(Boolean));
  for (const rule of rules) {
    const ruleName = rule.hostGroupName.trim().toLowerCase();
    if (ruleName && normalizedGroups.has(ruleName)) {
      const legacy = rule as EnvironmentHostGroupRule & { environment?: string };
      return legacy.environmentId ?? legacy.environment ?? BUILTIN_ENVIRONMENT_IDS.OTHER;
    }
  }
  return BUILTIN_ENVIRONMENT_IDS.OTHER;
}


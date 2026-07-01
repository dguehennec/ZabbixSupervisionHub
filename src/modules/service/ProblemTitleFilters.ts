// ============================================================
// modules/service/ProblemTitleFilters.ts — Hide problems by title regex
// ============================================================

import type { ProblemTitleHideRule, ZabbixProblem } from '../../types';

export interface CompiledTitlePattern {
  id: string;
  pattern: RegExp;
}

export function normalizeTitleHideRules(rules?: ProblemTitleHideRule[]): ProblemTitleHideRule[] {
  return (rules ?? [])
    .map((rule) => ({
      id: rule.id,
      pattern: rule.pattern.trim(),
    }))
    .filter((rule) => rule.pattern.length > 0);
}

export function compileTitleHidePattern(pattern: string): RegExp | null {
  const trimmed = pattern.trim();
  if (!trimmed) return null;
  try {
    return new RegExp(trimmed, 'i');
  } catch {
    return null;
  }
}

export function compileTitleHidePatterns(rules: ProblemTitleHideRule[]): CompiledTitlePattern[] {
  const compiled: CompiledTitlePattern[] = [];
  for (const rule of normalizeTitleHideRules(rules)) {
    const pattern = compileTitleHidePattern(rule.pattern);
    if (pattern) {
      compiled.push({ id: rule.id, pattern });
    }
  }
  return compiled;
}

export function isInvalidTitleHidePattern(pattern: string): boolean {
  const trimmed = pattern.trim();
  if (!trimmed) return false;
  return compileTitleHidePattern(trimmed) === null;
}

export function isProblemTitleHidden(title: string, patterns: CompiledTitlePattern[]): boolean {
  if (!patterns.length) return false;
  return patterns.some(({ pattern }) => pattern.test(title));
}

export function filterProblemsByTitleHideRules(
  problems: ZabbixProblem[],
  rules: ProblemTitleHideRule[],
): ZabbixProblem[] {
  const patterns = compileTitleHidePatterns(rules);
  if (!patterns.length) return problems;
  return problems.filter((p) => !isProblemTitleHidden(p.name, patterns));
}

export function isProblemHiddenByTitleRules(
  problem: Pick<ZabbixProblem, 'name'>,
  rules: ProblemTitleHideRule[],
): boolean {
  return isProblemTitleHidden(problem.name, compileTitleHidePatterns(rules));
}

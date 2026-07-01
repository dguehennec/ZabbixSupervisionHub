// ============================================================
// db/schema.ts — Dexie cache for problems, hosts, snoozes
// ============================================================

import Dexie, { type Table } from 'dexie';
import type { CachedHost, CachedProblem, SnoozedProblem } from '../types';

export class ZabbixCacheDb extends Dexie {
  problems!: Table<CachedProblem, string>;
  hosts!: Table<CachedHost, string>;
  snoozes!: Table<SnoozedProblem, string>;

  constructor() {
    super('ZabbixSupervisionHub');
    this.version(1).stores({
      problems: 'eventid, instanceId, severity, clock, environment, hostid, updatedAt',
      hosts: 'hostid, instanceId, name, status, updatedAt',
    });
    this.version(2).stores({
      problems: 'eventid, instanceId, severity, clock, environment, hostid, updatedAt',
      hosts: 'hostid, instanceId, name, status, updatedAt',
      snoozes: 'eventKey, instanceId, eventid, snoozeUntil, createdAt',
    });
  }
}

export const db = new ZabbixCacheDb();

export async function cacheProblems(problems: CachedProblem[]): Promise<void> {
  await db.transaction('rw', db.problems, async () => {
    const instanceIds = [...new Set(problems.map((p) => p.instanceId))];
    for (const instanceId of instanceIds) {
      await db.problems.where('instanceId').equals(instanceId).delete();
    }
    if (problems.length > 0) {
      await db.problems.bulkPut(problems);
    }
  });
}

export async function cacheHosts(hosts: CachedHost[]): Promise<void> {
  await db.transaction('rw', db.hosts, async () => {
    const instanceIds = [...new Set(hosts.map((h) => h.instanceId))];
    for (const instanceId of instanceIds) {
      await db.hosts.where('instanceId').equals(instanceId).delete();
    }
    if (hosts.length > 0) {
      await db.hosts.bulkPut(hosts);
    }
  });
}

export async function clearInstanceCache(instanceId: string): Promise<void> {
  await db.problems.where('instanceId').equals(instanceId).delete();
  await db.hosts.where('instanceId').equals(instanceId).delete();
}

export async function pruneExpiredSnoozes(): Promise<number> {
  const now = Date.now();
  return db.snoozes.where('snoozeUntil').below(now).delete();
}

export async function getActiveSnoozes(): Promise<SnoozedProblem[]> {
  const now = Date.now();
  return db.snoozes.where('snoozeUntil').above(now).toArray();
}

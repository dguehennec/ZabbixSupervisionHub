// ============================================================
// modules/service/SnoozeManager.ts — Per-incident snooze (mute)
// ============================================================

import type { SnoozedProblem } from '../../types';
import { db, pruneExpiredSnoozes, getActiveSnoozes } from '../../db/schema';

export function problemEventKey(instanceId: string, eventid: string): string {
  return `${instanceId}:${eventid}`;
}

export const SNOOZE_DURATIONS_SEC = {
  MIN_30: 30 * 60,
  HOUR_1: 60 * 60,
  HOUR_4: 4 * 60 * 60,
} as const;

export const SnoozeManager = {
  async snooze(instanceId: string, eventid: string, durationSec: number): Promise<SnoozedProblem> {
    const now = Date.now();
    const entry: SnoozedProblem = {
      eventKey: problemEventKey(instanceId, eventid),
      instanceId,
      eventid,
      snoozeUntil: now + durationSec * 1000,
      createdAt: now,
    };
    await db.snoozes.put(entry);
    return entry;
  },

  async unsnooze(instanceId: string, eventid: string): Promise<void> {
    await db.snoozes.delete(problemEventKey(instanceId, eventid));
  },

  async isSnoozed(instanceId: string, eventid: string): Promise<boolean> {
    await pruneExpiredSnoozes();
    const key = problemEventKey(instanceId, eventid);
    const entry = await db.snoozes.get(key);
    return !!entry && entry.snoozeUntil > Date.now();
  },

  async getSnoozedKeys(): Promise<Set<string>> {
    await pruneExpiredSnoozes();
    const active = await getActiveSnoozes();
    return new Set(active.map((s) => s.eventKey));
  },

  async getSnoozedList(): Promise<SnoozedProblem[]> {
    await pruneExpiredSnoozes();
    return getActiveSnoozes();
  },
};

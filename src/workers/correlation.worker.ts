// ============================================================
// workers/correlation.worker.ts — Off-main-thread problem grouping
// ============================================================

import { groupProblems } from '../modules/service/CorrelationEngine';
import type { ProblemGroup, ZabbixProblem } from '../types';

export interface CorrelationWorkerRequest {
  id: number;
  problems: ZabbixProblem[];
}

export interface CorrelationWorkerResponse {
  id: number;
  groups: ProblemGroup[];
}

self.onmessage = (ev: MessageEvent<CorrelationWorkerRequest>) => {
  const { id, problems } = ev.data;
  const groups = groupProblems(problems);
  const response: CorrelationWorkerResponse = { id, groups };
  self.postMessage(response);
};

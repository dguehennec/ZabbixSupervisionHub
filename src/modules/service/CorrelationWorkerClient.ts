// ============================================================
// modules/service/CorrelationWorkerClient.ts
// ============================================================

import type { ProblemGroup, ZabbixProblem } from '../../types';
import type { CorrelationWorkerRequest, CorrelationWorkerResponse } from '../../workers/correlation.worker';
import { groupProblems } from './CorrelationEngine';

let worker: Worker | null = null;
let requestId = 0;

function getWorker(): Worker | null {
  if (typeof Worker === 'undefined') return null;
  if (!worker) {
    try {
      worker = new Worker(new URL('../../workers/correlation.worker.ts', import.meta.url), {
        type: 'module',
      });
    } catch {
      return null;
    }
  }
  return worker;
}

export function groupProblemsAsync(problems: ZabbixProblem[]): Promise<ProblemGroup[]> {
  const w = getWorker();
  if (!w || problems.length < 50) {
    return Promise.resolve(groupProblems(problems));
  }

  const id = ++requestId;
  return new Promise((resolve, reject) => {
    const onMessage = (ev: MessageEvent<CorrelationWorkerResponse>) => {
      if (ev.data.id !== id) return;
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      resolve(ev.data.groups);
    };
    const onError = (e: ErrorEvent) => {
      w.removeEventListener('message', onMessage);
      w.removeEventListener('error', onError);
      reject(e.error ?? new Error(e.message));
    };
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
    w.postMessage({ id, problems } satisfies CorrelationWorkerRequest);
  });
}

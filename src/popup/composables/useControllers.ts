import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type { ControllerInfo, ZabbixProblem } from '../../types';
import { sendBackground, onBackgroundRefresh } from '../../ui/rpc';
import { onMounted, onUnmounted } from 'vue';

export function useControllers() {
  const { data: controllers, refetch, isFetching } = useQuery({
    queryKey: ['controllers'],
    queryFn: () => sendBackground<ControllerInfo[]>('getControllers'),
  });

  const allProblems = computed<ZabbixProblem[]>(() =>
    (controllers.value ?? []).flatMap((c) => c.problems),
  );

  async function refreshAll(): Promise<void> {
    await refetch();
  }

  async function checkNow(): Promise<void> {
    const ctrls = controllers.value ?? [];
    await Promise.all(ctrls.map((c) => sendBackground('checkNow', c.id)));
    await refreshAll();
  }

  let unsubscribe: (() => void) | undefined;

  onMounted(() => {
    unsubscribe = onBackgroundRefresh(() => refreshAll());
  });

  onUnmounted(() => {
    unsubscribe?.();
  });

  return { controllers, allProblems, refreshAll, checkNow, isFetching };
}

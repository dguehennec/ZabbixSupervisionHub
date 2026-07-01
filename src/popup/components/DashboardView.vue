<script setup lang="ts">
import { computed } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type { ZabbixProblem, AppPrefs } from '../../types';
import { computeProblemSummary } from '../../modules/service/Util';
import { environmentLabelById } from '../../modules/service/Environments';
import { sendBackground, i18n } from '../../ui/rpc';

const props = defineProps<{
  problems: ZabbixProblem[];
}>();

const summary = computed(() => computeProblemSummary(props.problems));

const { data: prefs } = useQuery({
  queryKey: ['prefs'],
  queryFn: () => sendBackground<AppPrefs>('getPrefs'),
});

const envCounts = computed(() => {
  const map = new Map<string, number>();
  for (const p of props.problems) {
    map.set(p.environment, (map.get(p.environment) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
});

const impactedHosts = computed(() => new Set(props.problems.map((p) => `${p.instanceId}:${p.hostid}`)).size);

const topCritical = computed(() =>
  [...props.problems]
    .sort((a, b) => b.severity - a.severity || b.clock - a.clock)
    .slice(0, 5),
);

function envLabel(id: string): string {
  return environmentLabelById(id, prefs.value?.environments ?? []);
}
</script>

<template>
  <section class="space-y-3">
    <div class="grid grid-cols-3 gap-2">
      <div class="card text-center">
        <div class="text-xl font-bold text-zabbix-disaster">{{ summary.disaster }}</div>
        <div class="text-[10px] uppercase text-slate-500">{{ i18n('severity_disaster') }}</div>
      </div>
      <div class="card text-center">
        <div class="text-xl font-bold text-zabbix-high">{{ summary.high }}</div>
        <div class="text-[10px] uppercase text-slate-500">{{ i18n('severity_high') }}</div>
      </div>
      <div class="card text-center">
        <div class="text-xl font-bold text-zabbix-average">{{ summary.average + summary.warning }}</div>
        <div class="text-[10px] uppercase text-slate-500">{{ i18n('severity_warning') }}+</div>
      </div>
    </div>

    <div class="card flex justify-between text-sm">
      <span class="text-slate-400">{{ i18n('hosts_impacted') }}</span>
      <span class="font-semibold text-white">{{ impactedHosts }}</span>
    </div>

    <div v-if="envCounts.length" class="card">
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">{{ i18n('by_environment') }}</h3>
      <div class="space-y-1">
        <div v-for="[env, count] in envCounts" :key="env" class="flex justify-between text-sm">
          <span class="text-slate-300">{{ envLabel(env) }}</span>
          <span class="font-medium text-white">{{ count }}</span>
        </div>
      </div>
    </div>

    <div v-if="topCritical.length" class="card">
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">{{ i18n('top_critical') }}</h3>
      <ul class="space-y-2">
        <li v-for="p in topCritical" :key="p.eventid" class="text-sm">
          <div class="truncate font-medium text-white">{{ p.name }}</div>
          <div class="text-xs text-slate-500">{{ p.hostName }} · {{ p.instanceAlias }}</div>
        </li>
      </ul>
    </div>
  </section>
</template>

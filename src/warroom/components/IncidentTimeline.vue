<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ZabbixProblem } from '../../types';
import { ZabbixSeverity } from '../../types';
import { findCorrelatedOnHost } from '../../modules/service/CorrelationEngine';
import { formatClock, severityLabel } from '../../modules/service/Util';
import { i18n } from '../../ui/rpc';

const props = defineProps<{
  problems: ZabbixProblem[];
  highlightEventId?: string;
  timeStartSec: number;
  timeEndSec: number;
}>();

const visibleHosts = ref<Set<string>>(new Set());

function hostKey(p: ZabbixProblem): string {
  return `${p.instanceId}:${p.hostid}`;
}

interface HostRow {
  key: string;
  hostName: string;
  instanceAlias: string;
  problems: ZabbixProblem[];
}

const hosts = computed<HostRow[]>(() => {
  const map = new Map<string, HostRow>();
  for (const p of props.problems) {
    const key = hostKey(p);
    let row = map.get(key);
    if (!row) {
      row = { key, hostName: p.hostName, instanceAlias: p.instanceAlias, problems: [] };
      map.set(key, row);
    }
    row.problems.push(p);
  }
  return Array.from(map.values()).sort(
    (a, b) =>
      Math.max(...b.problems.map((p) => p.severity)) - Math.max(...a.problems.map((p) => p.severity)) ||
      b.problems.length - a.problems.length ||
      a.hostName.localeCompare(b.hostName),
  );
});

watch(
  hosts,
  (rows) => {
    const next = new Set(visibleHosts.value);
    for (const row of rows) {
      if (!next.has(row.key)) next.add(row.key);
    }
    for (const key of [...next]) {
      if (!rows.some((r) => r.key === key)) next.delete(key);
    }
    visibleHosts.value = next;
  },
  { immediate: true },
);

const timeEnd = computed(() => props.timeEndSec);

const timeStart = computed(() => props.timeStartSec);

const timeRange = computed(() => Math.max(1, timeEnd.value - timeStart.value));

const visibleRows = computed(() => hosts.value.filter((h) => visibleHosts.value.has(h.key)));

const correlatedEventIds = computed(() => {
  const ids = new Set<string>();
  for (const cluster of findCorrelatedOnHost(props.problems, 300).values()) {
    for (const p of cluster) ids.add(p.eventid);
  }
  return ids;
});

const timeTicks = computed(() => {
  const ticks: { label: string; percent: number }[] = [];
  const count = 6;
  for (let i = 0; i <= count; i++) {
    const t = timeStart.value + (timeRange.value * i) / count;
    const d = new Date(t * 1000);
    ticks.push({
      label: d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      percent: (i / count) * 100,
    });
  }
  return ticks;
});

function timePercent(clock: number): number {
  return Math.min(100, Math.max(0, ((clock - timeStart.value) / timeRange.value) * 100));
}

function severityBgClass(severity: ZabbixSeverity): string {
  const map: Record<ZabbixSeverity, string> = {
    [ZabbixSeverity.NOT_CLASSIFIED]: 'bg-slate-500',
    [ZabbixSeverity.INFORMATION]: 'bg-zabbix-info',
    [ZabbixSeverity.WARNING]: 'bg-zabbix-warning',
    [ZabbixSeverity.AVERAGE]: 'bg-zabbix-average',
    [ZabbixSeverity.HIGH]: 'bg-zabbix-high',
    [ZabbixSeverity.DISASTER]: 'bg-zabbix-disaster',
  };
  return map[severity];
}

function toggleHost(key: string): void {
  const next = new Set(visibleHosts.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  visibleHosts.value = next;
}

function selectAllHosts(): void {
  visibleHosts.value = new Set(hosts.value.map((h) => h.key));
}

function deselectAllHosts(): void {
  visibleHosts.value = new Set();
}

function isCorrelated(eventid: string): boolean {
  return correlatedEventIds.value.has(eventid);
}
</script>

<template>
  <section class="card flex h-full flex-col">
    <div class="mb-3 flex shrink-0 items-start justify-between gap-3">
      <div>
        <h2 class="text-lg font-semibold">{{ i18n('warroom_timeline') }}</h2>
        <p class="text-xs text-slate-500">{{ i18n('warroom_timeline_hint') }}</p>
      </div>
      <div class="flex shrink-0 gap-2">
        <button type="button" class="btn btn-secondary text-xs" @click="selectAllHosts">
          {{ i18n('warroom_select_all_hosts') }}
        </button>
        <button type="button" class="btn btn-secondary text-xs" @click="deselectAllHosts">
          {{ i18n('warroom_deselect_all_hosts') }}
        </button>
      </div>
    </div>

    <div class="mb-3 shrink-0">
      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">{{ i18n('warroom_timeline_hosts') }}</h3>
      <div class="flex max-h-24 flex-wrap gap-x-4 gap-y-1 overflow-y-auto text-sm">
        <label
          v-for="row in hosts"
          :key="row.key"
          class="flex cursor-pointer items-center gap-1.5 text-slate-300"
        >
          <input
            type="checkbox"
            class="rounded border-slate-600 bg-slate-800"
            :checked="visibleHosts.has(row.key)"
            @change="toggleHost(row.key)"
          />
          <span class="truncate" :title="`${row.hostName} (${row.instanceAlias})`">
            {{ row.hostName }}
          </span>
          <span class="text-[10px] text-slate-600">({{ row.problems.length }})</span>
        </label>
      </div>
    </div>

    <div v-if="!visibleRows.length" class="flex flex-1 items-center justify-center text-slate-500">
      {{ i18n('warroom_no_incidents') }}
    </div>

    <div v-else class="min-h-0 flex-1 overflow-auto">
      <div class="relative mb-2 ml-36 h-6 border-b border-slate-700">
        <span
          v-for="(tick, i) in timeTicks"
          :key="i"
          class="absolute -translate-x-1/2 text-[10px] text-slate-500"
          :style="{ left: `${tick.percent}%` }"
        >
          {{ tick.label }}
        </span>
      </div>

      <div
        v-for="row in visibleRows"
        :key="row.key"
        class="mb-1 flex items-center gap-2"
      >
        <div class="w-32 shrink-0 truncate text-right text-xs text-slate-400" :title="row.hostName">
          {{ row.hostName }}
        </div>
        <div class="relative h-8 flex-1 rounded bg-slate-900/80">
          <div
            v-for="tick in timeTicks"
            :key="`grid-${row.key}-${tick.percent}`"
            class="absolute inset-y-0 border-l border-slate-800/60"
            :style="{ left: `${tick.percent}%` }"
          />
          <div
            v-for="p in row.problems"
            :key="p.eventid"
            class="absolute top-1/2 z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 transition-transform hover:scale-125"
            :class="[
              severityBgClass(p.severity),
              isCorrelated(p.eventid) ? 'border-amber-300 ring-2 ring-amber-400/50' : 'border-slate-950',
              highlightEventId === p.eventid ? 'ring-2 ring-sky-400 scale-125' : '',
            ]"
            :style="{ left: `${timePercent(p.clock)}%` }"
            :title="`${severityLabel(p.severity)} — ${p.name}\n${formatClock(p.clock)}`"
          />
        </div>
      </div>
    </div>
  </section>
</template>

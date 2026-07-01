<script setup lang="ts">
import { computed } from 'vue';
import type { ZabbixProblem } from '../../types';
import { i18n } from '../../ui/rpc';
import { formatDuration, severityColorClass, severityLabel } from '../../modules/service/Util';

const props = defineProps<{
  problems: ZabbixProblem[];
  selectedEventId?: string;
}>();

const emit = defineEmits<{
  select: [problem: ZabbixProblem];
}>();

const incidents = computed(() =>
  [...props.problems].sort((a, b) => b.clock - a.clock || b.severity - a.severity),
);
</script>

<template>
  <section class="card flex h-full flex-col">
    <h2 class="mb-3 shrink-0 text-lg font-semibold">{{ i18n('warroom_incidents') }}</h2>
    <ul class="min-h-0 flex-1 space-y-2 overflow-y-auto">
      <li
        v-for="p in incidents"
        :key="p.eventid"
        class="cursor-pointer rounded border p-3 transition-colors"
        :class="
          selectedEventId === p.eventid
            ? 'border-sky-500 bg-sky-950/40'
            : 'border-slate-800 bg-slate-900/60 hover:border-slate-700'
        "
        @click="emit('select', p)"
      >
        <div class="mb-1 flex items-center justify-between gap-2">
          <span class="badge" :class="severityColorClass(p.severity)">{{ severityLabel(p.severity) }}</span>
          <span class="text-xs text-slate-500">{{ formatDuration(p.clock) }}</span>
        </div>
        <div class="font-medium text-white">{{ p.name }}</div>
        <div class="text-sm text-slate-400">{{ p.hostName }} · {{ p.instanceAlias }}</div>
      </li>
      <li v-if="!incidents.length" class="text-slate-500">{{ i18n('warroom_no_incidents') }}</li>
    </ul>
  </section>
</template>

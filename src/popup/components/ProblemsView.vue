<script setup lang="ts">
import { computed, ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type { ControllerInfo, FilterPreset, ProblemGroup, ZabbixProblem, AppPrefs } from '../../types';
import { ZabbixSeverity } from '../../types';
import { sendBackground, i18n } from '../../ui/rpc';
import {
  filterProblems,
  formatDuration,
  randomHex,
  severityColorClass,
  severityLabel,
} from '../../modules/service/Util';
import { environmentLabel, visibleEnvironments } from '../../modules/service/Environments';
import ProblemDetailPanel from './ProblemDetailPanel.vue';

const props = defineProps<{
  problems: ZabbixProblem[];
  controllers: ControllerInfo[];
}>();

const emit = defineEmits<{ refresh: [] }>();

const search = ref('');
const selectedSeverities = ref<ZabbixSeverity[]>([
  ZabbixSeverity.DISASTER,
  ZabbixSeverity.HIGH,
  ZabbixSeverity.AVERAGE,
  ZabbixSeverity.WARNING,
]);
const selectedEnvironment = ref('');
const selectedInstance = ref('');
const unacknowledgedOnly = ref(false);
const groupByTrigger = ref(false);
const selectedProblem = ref<ZabbixProblem | null>(null);
const expandedGroups = ref<Set<string>>(new Set());

const { data: prefs } = useQuery({
  queryKey: ['prefs'],
  queryFn: () => sendBackground<AppPrefs>('getPrefs'),
});

const filterEnvironments = computed(() =>
  visibleEnvironments(prefs.value?.environments ?? []),
);

const filteredProblems = computed(() =>
  filterProblems(props.problems, {
    search: search.value,
    severities: selectedSeverities.value,
    environment: selectedEnvironment.value || undefined,
    instanceId: selectedInstance.value || undefined,
    unacknowledgedOnly: unacknowledgedOnly.value || undefined,
  }),
);

const { data: groups } = useQuery({
  queryKey: ['groupedProblems', () => props.problems.length],
  queryFn: () => sendBackground<ProblemGroup[]>('getGroupedProblems'),
  enabled: computed(() => groupByTrigger.value),
});

const displayGroups = computed(() => {
  if (!groupByTrigger.value || !groups.value) return null;
  const filteredIds = new Set(filteredProblems.value.map((p) => p.eventid));
  return groups.value
    .map((g) => ({
      ...g,
      problems: g.problems
        .filter((p) => filteredIds.has(p.eventid))
        .sort((a, b) => b.clock - a.clock),
    }))
    .filter((g) => g.problems.length > 0)
    .sort((a, b) => Math.max(...b.problems.map((p) => p.clock)) - Math.max(...a.problems.map((p) => p.clock)));
});

const severityOptions = [
  ZabbixSeverity.DISASTER,
  ZabbixSeverity.HIGH,
  ZabbixSeverity.AVERAGE,
  ZabbixSeverity.WARNING,
  ZabbixSeverity.INFORMATION,
  ZabbixSeverity.NOT_CLASSIFIED,
];

function toggleSeverity(sev: ZabbixSeverity): void {
  const idx = selectedSeverities.value.indexOf(sev);
  if (idx >= 0) selectedSeverities.value.splice(idx, 1);
  else selectedSeverities.value.push(sev);
}

function toggleGroup(key: string): void {
  const next = new Set(expandedGroups.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expandedGroups.value = next;
}

async function applyPreset(preset: FilterPreset): Promise<void> {
  search.value = preset.search ?? '';
  selectedSeverities.value = preset.severities ?? [...severityOptions];
  selectedEnvironment.value = preset.environment ?? '';
  selectedInstance.value = preset.instanceId ?? '';
  unacknowledgedOnly.value = preset.unacknowledgedOnly ?? false;
  groupByTrigger.value = preset.groupByTrigger ?? false;
}

async function saveCurrentPreset(): Promise<void> {
  const name = prompt(i18n('preset_name_prompt'));
  if (!name?.trim()) return;
  const preset: FilterPreset = {
    id: randomHex(8),
    name: name.trim(),
    search: search.value || undefined,
    severities: [...selectedSeverities.value],
    environment: selectedEnvironment.value || undefined,
    instanceId: selectedInstance.value || undefined,
    unacknowledgedOnly: unacknowledgedOnly.value || undefined,
    groupByTrigger: groupByTrigger.value || undefined,
  };
  await sendBackground('saveFilterPreset', preset);
}

function onAcknowledged(): void {
  if (selectedProblem.value) selectedProblem.value.acknowledged = true;
  emit('refresh');
}
</script>

<template>
  <section class="space-y-2">
    <input v-model="search" class="input" type="search" :placeholder="i18n('search_placeholder')" />

    <div class="flex flex-wrap gap-1">
      <button
        v-for="sev in severityOptions"
        :key="sev"
        class="badge border border-slate-700"
        :class="[severityColorClass(sev), selectedSeverities.includes(sev) ? 'ring-1 ring-blue-400' : 'opacity-50']"
        @click="toggleSeverity(sev)"
      >
        {{ severityLabel(sev) }}
      </button>
    </div>

    <div class="grid grid-cols-2 gap-2">
      <select v-model="selectedEnvironment" class="input">
        <option value="">{{ i18n('filter_all_environments') }}</option>
        <option v-for="env in filterEnvironments" :key="env.id" :value="env.id">
          {{ environmentLabel(env) }}
        </option>
      </select>
      <select v-model="selectedInstance" class="input">
        <option value="">{{ i18n('filter_all_instances') }}</option>
        <option v-for="c in controllers" :key="c.id" :value="c.instanceId">
          {{ c.instanceAlias || c.instanceApiUrl }}
        </option>
      </select>
    </div>

    <div class="flex flex-wrap items-center gap-2 text-xs">
      <label class="flex items-center gap-1 text-slate-400">
        <input v-model="unacknowledgedOnly" type="checkbox" class="rounded" />
        {{ i18n('filter_unacknowledged') }}
      </label>
      <label class="flex items-center gap-1 text-slate-400">
        <input v-model="groupByTrigger" type="checkbox" class="rounded" />
        {{ i18n('group_by_trigger') }}
      </label>
      <button class="btn btn-secondary text-xs" @click="saveCurrentPreset">{{ i18n('save_filter') }}</button>
    </div>

    <div v-if="prefs?.filterPresets?.length" class="flex flex-wrap gap-1">
      <button
        v-for="preset in prefs.filterPresets"
        :key="preset.id"
        class="badge border border-slate-600 text-slate-300"
        @click="applyPreset(preset)"
      >
        ★ {{ preset.name }}
      </button>
    </div>

    <div class="max-h-[280px] space-y-2 overflow-y-auto">
      <div v-if="!filteredProblems.length" class="card text-center text-slate-500">
        {{ i18n('no_problems') }}
      </div>

      <template v-if="displayGroups">
        <article v-for="group in displayGroups" :key="group.key" class="card">
          <button
            class="flex w-full items-center justify-between text-left"
            @click="toggleGroup(group.key)"
          >
            <div>
              <span class="badge mr-2" :class="severityColorClass(group.severity)">
                {{ severityLabel(group.severity) }}
              </span>
              <span class="font-medium text-white">{{ group.name }}</span>
            </div>
            <span class="text-xs text-slate-500">
              {{ group.problems.length }} · {{ group.hostCount }} {{ i18n('hosts') }}
            </span>
          </button>
          <ul v-if="expandedGroups.has(group.key)" class="mt-2 space-y-1 border-t border-slate-700 pt-2">
            <li
              v-for="p in group.problems"
              :key="p.eventid"
              class="cursor-pointer rounded px-2 py-1 text-sm hover:bg-slate-800"
              @click="selectedProblem = p"
            >
              {{ p.hostName }} · {{ formatDuration(p.clock) }}
            </li>
          </ul>
        </article>
      </template>

      <template v-else>
        <article
          v-for="problem in filteredProblems"
          :key="problem.eventid"
          class="card cursor-pointer border-l-4 hover:bg-slate-800/50"
          :class="{
            'border-zabbix-disaster': problem.severity === ZabbixSeverity.DISASTER,
            'border-zabbix-high': problem.severity === ZabbixSeverity.HIGH,
            'border-zabbix-average': problem.severity === ZabbixSeverity.AVERAGE,
            'border-zabbix-warning': problem.severity === ZabbixSeverity.WARNING,
            'border-zabbix-info': problem.severity === ZabbixSeverity.INFORMATION,
            'border-slate-600': problem.severity === ZabbixSeverity.NOT_CLASSIFIED,
          }"
          @click="selectedProblem = problem"
        >
          <div class="mb-1 flex items-start justify-between gap-2">
            <span class="badge" :class="severityColorClass(problem.severity)">
              {{ severityLabel(problem.severity) }}
            </span>
            <span class="text-[10px] text-slate-500">{{ formatDuration(problem.clock) }}</span>
          </div>
          <h3 class="mb-1 font-medium leading-tight text-white">{{ problem.name }}</h3>
          <p class="text-xs text-slate-400">
            {{ problem.hostName }}
            <span v-if="problem.instanceAlias"> · {{ problem.instanceAlias }}</span>
            <span v-if="problem.acknowledged" class="text-green-500"> · ✓</span>
          </p>
        </article>
      </template>
    </div>

    <ProblemDetailPanel
      :problem="selectedProblem"
      @close="selectedProblem = null"
      @acknowledged="onAcknowledged"
      @snoozed="emit('refresh')"
    />
  </section>
</template>

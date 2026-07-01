<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ZabbixEvent, ZabbixProblem } from '../../types';
import { sendBackground, i18n } from '../../ui/rpc';
import { SNOOZE_DURATIONS_SEC } from '../../modules/service/SnoozeManager';
import {
  formatClock,
  formatDuration,
  severityColorClass,
  severityLabel,
} from '../../modules/service/Util';

const props = defineProps<{
  problem: ZabbixProblem | null;
}>();

const emit = defineEmits<{
  close: [];
  acknowledged: [];
  snoozed: [];
}>();

const isSnoozed = ref(false);

const timeline = ref<ZabbixEvent[]>([]);
const loading = ref(false);
const ackMessage = ref('');
const acking = ref(false);

watch(
  () => props.problem,
  async (p) => {
    timeline.value = [];
    isSnoozed.value = false;
    if (!p) return;
    const keys = await sendBackground<string[]>('getSnoozedKeys');
    isSnoozed.value = keys.includes(`${p.instanceId}:${p.eventid}`);
    if (!p.hostid) return;
    loading.value = true;
    try {
      timeline.value = await sendBackground<ZabbixEvent[]>(
        'getHostTimeline',
        p.instanceId,
        p.hostid,
      );
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

async function acknowledge(): Promise<void> {
  if (!props.problem) return;
  acking.value = true;
  try {
    const ok = await sendBackground<boolean>(
      'acknowledgeProblem',
      props.problem.instanceId,
      props.problem.eventid,
      ackMessage.value || i18n('ack_default_message'),
    );
    if (ok) emit('acknowledged');
  } finally {
    acking.value = false;
  }
}

function openHost(): void {
  if (!props.problem) return;
  sendBackground('openZabbixHost', props.problem.instanceId, props.problem.hostid);
}

function openProblem(): void {
  if (!props.problem) return;
  sendBackground('openZabbixProblem', props.problem.instanceId, props.problem.eventid);
}

async function snooze(durationSec: number): Promise<void> {
  if (!props.problem) return;
  await sendBackground('snoozeProblem', props.problem.instanceId, props.problem.eventid, durationSec);
  isSnoozed.value = true;
  emit('snoozed');
}

async function unsnooze(): Promise<void> {
  if (!props.problem) return;
  await sendBackground('unsnoozeProblem', props.problem.instanceId, props.problem.eventid);
  isSnoozed.value = false;
  emit('snoozed');
}
</script>

<template>
  <div v-if="problem" class="fixed inset-0 z-50 flex flex-col bg-slate-900">
    <header class="flex items-center justify-between border-b border-slate-700 p-3">
      <button class="btn btn-secondary text-sm" @click="emit('close')">← {{ i18n('back') }}</button>
      <div class="flex gap-1">
        <button class="btn btn-secondary text-xs" @click="openHost">{{ i18n('open_host') }}</button>
        <button class="btn btn-secondary text-xs" @click="openProblem">{{ i18n('open_problem') }}</button>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto p-3">
      <span class="badge mb-2" :class="severityColorClass(problem.severity)">
        {{ severityLabel(problem.severity) }}
      </span>
      <h2 class="mb-1 text-base font-bold text-white">{{ problem.name }}</h2>
      <p class="mb-3 text-sm text-slate-400">
        {{ problem.hostName }} · {{ problem.instanceAlias }} · {{ formatDuration(problem.clock) }}
      </p>

      <div v-if="!problem.acknowledged" class="card mb-3 space-y-2">
        <h3 class="text-xs font-semibold uppercase text-slate-500">{{ i18n('acknowledge') }}</h3>
        <input v-model="ackMessage" class="input" :placeholder="i18n('ack_message_placeholder')" />
        <button class="btn btn-primary w-full" :disabled="acking" @click="acknowledge">
          {{ i18n('acknowledge') }}
        </button>
      </div>
      <p v-else class="mb-3 text-sm text-green-400">{{ i18n('acknowledged') }}</p>

      <div class="card mb-3 space-y-2">
        <h3 class="text-xs font-semibold uppercase text-slate-500">{{ i18n('snooze') }}</h3>
        <p v-if="isSnoozed" class="text-sm text-amber-400">{{ i18n('snoozed_active') }}</p>
        <div class="flex flex-wrap gap-1">
          <button class="btn btn-secondary text-xs" @click="snooze(SNOOZE_DURATIONS_SEC.MIN_30)">
            {{ i18n('snooze_30m') }}
          </button>
          <button class="btn btn-secondary text-xs" @click="snooze(SNOOZE_DURATIONS_SEC.HOUR_1)">
            {{ i18n('snooze_1h') }}
          </button>
          <button class="btn btn-secondary text-xs" @click="snooze(SNOOZE_DURATIONS_SEC.HOUR_4)">
            {{ i18n('snooze_4h') }}
          </button>
          <button v-if="isSnoozed" class="btn btn-danger text-xs" @click="unsnooze">
            {{ i18n('unsnooze') }}
          </button>
        </div>
      </div>

      <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">{{ i18n('host_timeline') }}</h3>
      <div v-if="loading" class="text-sm text-slate-500">{{ i18n('loading') }}…</div>
      <ul v-else class="space-y-2">
        <li v-for="ev in timeline" :key="ev.eventid" class="card text-sm">
          <div class="flex justify-between gap-2">
            <span class="truncate text-white">{{ ev.name }}</span>
            <span class="shrink-0 text-[10px] text-slate-500">{{ formatClock(ev.clock) }}</span>
          </div>
          <span class="badge mt-1 text-[10px]" :class="severityColorClass(ev.severity)">
            {{ severityLabel(ev.severity) }}
          </span>
        </li>
        <li v-if="!timeline.length" class="text-sm text-slate-500">{{ i18n('no_timeline_events') }}</li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useQuery } from '@tanstack/vue-query';
import type { InfraEnvironmentNode, AppPrefs } from '../../types';
import { ZabbixSeverity } from '../../types';
import { sendBackground, i18n } from '../../ui/rpc';
import { environmentLabelById } from '../../modules/service/Environments';

const expandedEnv = ref<Set<string>>(new Set());
const expandedInstance = ref<Set<string>>(new Set());

const { data: tree, refetch } = useQuery({
  queryKey: ['infrastructure'],
  queryFn: () => sendBackground<InfraEnvironmentNode[]>('getInfrastructure'),
});

const { data: prefs } = useQuery({
  queryKey: ['prefs'],
  queryFn: () => sendBackground<AppPrefs>('getPrefs'),
});

function envLabel(id: string): string {
  return environmentLabelById(id, prefs.value?.environments ?? []);
}

function toggle(set: Set<string>, key: string): void {
  if (set.has(key)) set.delete(key);
  else set.add(key);
}

function severityDot(sev: ZabbixSeverity): string {
  if (sev >= ZabbixSeverity.DISASTER) return 'bg-zabbix-disaster';
  if (sev >= ZabbixSeverity.HIGH) return 'bg-zabbix-high';
  if (sev >= ZabbixSeverity.AVERAGE) return 'bg-zabbix-average';
  if (sev >= ZabbixSeverity.WARNING) return 'bg-zabbix-warning';
  if (sev >= ZabbixSeverity.INFORMATION) return 'bg-zabbix-info';
  return 'bg-green-500';
}

async function toggleFavorite(instanceId: string, hostid: string): Promise<void> {
  await sendBackground('toggleFavoriteHost', `${instanceId}:${hostid}`);
  await refetch();
}

function openHost(instanceId: string, hostid: string): void {
  sendBackground('openZabbixHost', instanceId, hostid);
}
</script>

<template>
  <section class="max-h-[420px] overflow-y-auto">
    <div v-if="!tree?.length" class="card text-center text-slate-500">{{ i18n('no_instances') }}</div>

    <div v-for="envNode in tree ?? []" :key="envNode.environment" class="mb-2">
      <button
        class="flex w-full items-center justify-between rounded bg-slate-800 px-3 py-2 text-left text-sm font-semibold text-white"
        @click="toggle(expandedEnv, envNode.environment)"
      >
        <span>{{ envLabel(envNode.environment) }}</span>
        <span class="text-xs text-slate-400">{{ envNode.problemCount }} {{ i18n('problems') }}</span>
      </button>

      <div v-if="expandedEnv.has(envNode.environment)" class="ml-2 mt-1 space-y-1 border-l border-slate-700 pl-2">
        <div v-for="inst in envNode.instances" :key="`${envNode.environment}-${inst.instanceId}`">
          <button
            class="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-slate-800"
            @click="toggle(expandedInstance, `${envNode.environment}-${inst.instanceId}`)"
          >
            <span class="flex items-center gap-2">
              <span
                class="h-2 w-2 rounded-full"
                :class="inst.isConnected ? 'bg-green-500' : 'bg-slate-600'"
              />
              {{ inst.alias }}
            </span>
            <span class="text-xs text-slate-500">{{ inst.problemCount }}</span>
          </button>

          <ul v-if="expandedInstance.has(`${envNode.environment}-${inst.instanceId}`)" class="ml-4 space-y-0.5">
            <li
              v-for="host in inst.hosts"
              :key="`${host.instanceId}:${host.hostid}`"
              class="flex items-center justify-between rounded px-2 py-1 text-xs hover:bg-slate-800"
            >
              <button class="flex flex-1 items-center gap-2 text-left" @click="openHost(host.instanceId, host.hostid)">
                <span class="h-2 w-2 shrink-0 rounded-full" :class="severityDot(host.maxSeverity)" />
                <span class="truncate text-slate-300">{{ host.name }}</span>
                <span v-if="host.problemCount" class="text-slate-500">({{ host.problemCount }})</span>
              </button>
              <button
                class="ml-1 text-slate-500 hover:text-yellow-400"
                :title="i18n('toggle_favorite')"
                @click.stop="toggleFavorite(host.instanceId, host.hostid)"
              >
                {{ host.isFavorite ? '★' : '☆' }}
              </button>
            </li>
          </ul>
        </div>
      </div>
    </div>
  </section>
</template>

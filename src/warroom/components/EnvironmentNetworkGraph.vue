<script setup lang="ts">
import type { EnvironmentHostStats } from "../utils/warRoomStats";
import { ZabbixSeverity } from "../../types";
import { i18n } from "../../ui/rpc";

defineProps<{
  stats: EnvironmentHostStats[];
  envLabel: (id: string) => string;
}>();

function severityClass(severity: ZabbixSeverity, hasError: boolean): string {
  if (!hasError) return "bg-emerald-500/90";
  const map: Record<ZabbixSeverity, string> = {
    [ZabbixSeverity.NOT_CLASSIFIED]: "bg-slate-400",
    [ZabbixSeverity.INFORMATION]: "bg-zabbix-info",
    [ZabbixSeverity.WARNING]: "bg-zabbix-warning",
    [ZabbixSeverity.AVERAGE]: "bg-zabbix-average",
    [ZabbixSeverity.HIGH]: "bg-zabbix-high",
    [ZabbixSeverity.DISASTER]: "bg-zabbix-disaster",
  };
  return map[severity];
}
</script>

<template>
  <section class="card flex min-h-0 flex-1 flex-col overflow-hidden">
    <div class="mb-3 shrink-0">
      <h2 class="text-lg font-semibold">{{ i18n("warroom_network_graph") }}</h2>
      <p class="text-xs text-slate-500">
        {{ i18n("warroom_network_graph_hint") }}
      </p>
    </div>

    <div v-if="!stats.length" class="py-8 text-center text-slate-500">
      {{ i18n("warroom_no_hosts") }}
    </div>

    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <div class="flex flex-wrap content-start items-start gap-3">
        <article
          v-for="lane in stats"
          :key="lane.environmentId"
          class="w-44 shrink-0 rounded-lg border border-slate-700 bg-slate-900/50 p-2"
          style="min-height: 234px"
        >
          <header class="mb-2 border-b border-slate-800 pb-2">
            <h3
              class="truncate text-sm font-semibold text-white"
              :title="envLabel(lane.environmentId)"
            >
              {{ envLabel(lane.environmentId) }}
            </h3>
            <div class="mt-1 flex flex-wrap gap-2 text-[10px]">
              <span class="text-emerald-400"
                >{{ lane.okHosts }} {{ i18n("warroom_hosts_ok") }}</span
              >
              <span class="text-red-400"
                >{{ lane.errorHosts }} {{ i18n("warroom_hosts_error") }}</span
              >
            </div>
          </header>

          <div v-if="lane.hosts.length" class="flex flex-wrap gap-1">
            <span
              v-for="host in lane.hosts"
              :key="host.key"
              class="h-2.5 w-2.5 shrink-0 rounded-full"
              :class="severityClass(host.maxSeverity, host.hasError)"
              :title="
                host.hasError
                  ? `${host.hostName} — ${host.problemCount} ${i18n('problems')}`
                  : `${host.hostName} — ${i18n('warroom_hosts_ok')}`
              "
            />
          </div>

          <p v-else class="text-center text-xs text-slate-600">
            {{ i18n("warroom_no_hosts") }}
          </p>
        </article>
      </div>
    </div>

    <footer
      class="mt-3 flex shrink-0 flex-wrap gap-3 border-t border-slate-800 pt-2 text-[10px] text-slate-500"
    >
      <span class="flex items-center gap-1"
        ><span class="inline-block h-2 w-2 rounded-full bg-emerald-500" />
        {{ i18n("warroom_hosts_ok") }}</span
      >
      <span class="flex items-center gap-1"
        ><span class="inline-block h-2 w-2 rounded-full bg-zabbix-high" />
        {{ i18n("warroom_hosts_error") }}</span
      >
    </footer>
  </section>
</template>

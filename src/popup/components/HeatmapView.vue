<script setup lang="ts">
import { computed, toRef } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type { HeatmapCell, ZabbixProblem } from "../../types";
import { ZabbixSeverity } from "../../types";
import { sendBackground, i18n } from "../../ui/rpc";
import { computeHeatmap, severityColorClass } from "../../modules/service/Util";

const props = defineProps<{
  refetchInterval?: number;
  /** When set (e.g. War Room period filter), heatmap is built from these problems instead of live RPC data. */
  problems?: ZabbixProblem[];
}>();

const severityLevels = [
  ZabbixSeverity.DISASTER,
  ZabbixSeverity.HIGH,
  ZabbixSeverity.AVERAGE,
  ZabbixSeverity.WARNING,
  ZabbixSeverity.INFORMATION,
];

const useRemoteHeatmap = computed(() => props.problems === undefined);

const { data: remoteCells, isLoading: isRemoteLoading } = useQuery({
  queryKey: ["heatmap"],
  queryFn: () => sendBackground<HeatmapCell[]>("getHeatmap"),
  refetchInterval: toRef(props, "refetchInterval"),
  enabled: useRemoteHeatmap,
});

const cells = computed<HeatmapCell[]>(() => {
  if (props.problems !== undefined) {
    return computeHeatmap(props.problems, []);
  }
  return remoteCells.value ?? [];
});

const isLoading = computed(() => useRemoteHeatmap.value && isRemoteLoading.value);

const maxTotal = computed(() =>
  Math.max(1, ...(cells.value ?? []).map((c) => c.total)),
);

function cellIntensity(count: number): string {
  if (count === 0) return "bg-slate-800";
  const ratio = count / maxTotal.value;
  if (ratio > 0.75) return "bg-zabbix-disaster/80";
  if (ratio > 0.5) return "bg-zabbix-high/70";
  if (ratio > 0.25) return "bg-zabbix-average/60";
  return "bg-zabbix-warning/50";
}

function heatColor(severity: ZabbixSeverity): string {
  const map: Record<ZabbixSeverity, string> = {
    [ZabbixSeverity.DISASTER]: "bg-zabbix-disaster",
    [ZabbixSeverity.HIGH]: "bg-zabbix-high",
    [ZabbixSeverity.AVERAGE]: "bg-zabbix-average",
    [ZabbixSeverity.WARNING]: "bg-zabbix-warning",
    [ZabbixSeverity.INFORMATION]: "bg-zabbix-info",
    [ZabbixSeverity.NOT_CLASSIFIED]: "bg-slate-600",
  };
  return map[severity];
}
</script>

<template>
  <section>
    <p class="mb-2 text-xs text-slate-500">
      {{ i18n(problems !== undefined ? "heatmap_hint_period" : "heatmap_hint") }}
    </p>

    <div v-if="isLoading" class="text-sm text-slate-500">
      {{ i18n("loading") }}…
    </div>
    <div v-else-if="!cells?.length" class="card text-center text-slate-500">
      {{ i18n("no_problems") }}
    </div>

    <div v-else class="overflow-y-auto">
      <table class="w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500">
            <th class="pb-2 pr-2">{{ i18n("host") }}</th>
            <th
              v-for="sev in severityLevels"
              :key="sev"
              class="pb-2 px-0.5 text-center w-8"
            >
              <span :class="severityColorClass(sev)">{{ sev }}</span>
            </th>
            <th class="pb-2 pl-2 text-center">{{ i18n("total") }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="cell in cells"
            :key="`${cell.instanceId}:${cell.hostid}`"
            class="border-t border-slate-800"
          >
            <td class="py-1.5 pr-2">
              <div
                class="truncate font-medium text-white"
                :title="cell.hostName"
              >
                {{ cell.hostName }}
              </div>
              <div class="truncate text-[10px] text-slate-600">
                {{ cell.instanceAlias }}
              </div>
            </td>
            <td
              v-for="sev in severityLevels"
              :key="sev"
              class="px-0.5 py-1.5 text-center"
            >
              <span
                class="inline-flex h-6 w-6 items-center justify-center rounded text-[10px] font-bold"
                :class="
                  cell.counts[sev] > 0
                    ? heatColor(sev)
                    : 'bg-slate-800 text-slate-600'
                "
              >
                {{ cell.counts[sev] || "" }}
              </span>
            </td>
            <td class="py-1.5 pl-2 text-center">
              <span
                class="inline-block min-w-[1.5rem] rounded px-1 py-0.5 font-bold text-white"
                :class="cellIntensity(cell.total)"
              >
                {{ cell.total }}
              </span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

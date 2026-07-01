<script setup lang="ts">
import { computed } from "vue";
import type { EnvironmentProblemSlice } from "../utils/warRoomStats";
import { environmentChartColor } from "../utils/warRoomStats";
import { i18n } from "../../ui/rpc";

const props = defineProps<{
  slices: EnvironmentProblemSlice[];
  envLabel: (id: string) => string;
}>();

const RADIUS = 15.9;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const total = computed(() => props.slices.reduce((sum, s) => sum + s.count, 0));

const segments = computed(() => {
  if (total.value === 0) return [];
  let offset = 0;
  return props.slices.map((slice, index) => {
    const length = (slice.count / total.value) * CIRCUMFERENCE;
    const segment = {
      ...slice,
      index,
      color: environmentChartColor(index),
      dashArray: `${length} ${CIRCUMFERENCE - length}`,
      dashOffset: -offset,
    };
    offset += length;
    return segment;
  });
});
</script>

<template>
  <section
    class="mb-3 shrink-0 rounded-lg border border-slate-800 bg-slate-900/60 p-3"
  >
    <h2 class="mb-2 shrink-0 text-lg font-semibold">
      {{ i18n("warroom_errors_by_env") }}
    </h2>

    <div v-if="!total" class="py-4 text-center text-xs text-slate-500">
      {{ i18n("warroom_no_incidents") }}
    </div>

    <div v-else class="flex items-center gap-4">
      <svg viewBox="0 0 36 36" class="h-24 w-24 shrink-0 -rotate-90">
        <circle
          cx="18"
          cy="18"
          :r="RADIUS"
          fill="none"
          stroke="#1e293b"
          stroke-width="3.2"
        />
        <circle
          v-for="seg in segments"
          :key="seg.environmentId"
          cx="18"
          cy="18"
          :r="RADIUS"
          fill="none"
          :stroke="seg.color"
          stroke-width="3.2"
          :stroke-dasharray="seg.dashArray"
          :stroke-dashoffset="seg.dashOffset"
        />
      </svg>

      <ul class="min-w-0 flex-1 space-y-1 text-xs">
        <li
          v-for="seg in segments"
          :key="`legend-${seg.environmentId}`"
          class="flex items-center justify-between gap-2"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <span
              class="h-2 w-2 shrink-0 rounded-full"
              :style="{ backgroundColor: seg.color }"
            />
            <span
              class="truncate text-slate-300"
              :title="envLabel(seg.environmentId)"
            >
              {{ envLabel(seg.environmentId) }}
            </span>
          </span>
          <span class="shrink-0 font-medium text-white">{{ seg.count }}</span>
        </li>
      </ul>
    </div>
  </section>
</template>

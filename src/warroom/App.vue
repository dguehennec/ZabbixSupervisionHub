<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useQuery } from "@tanstack/vue-query";
import type {
  AppPrefs,
  ControllerInfo,
  InfraEnvironmentNode,
  ZabbixProblem,
} from "../types";
import { sendBackground, i18n, onBackgroundRefresh } from "../ui/rpc";
import { environmentLabelById } from "../modules/service/Environments";
import IncidentList from "./components/IncidentList.vue";
import IncidentTimeline from "./components/IncidentTimeline.vue";
import EnvironmentNetworkGraph from "./components/EnvironmentNetworkGraph.vue";
import EnvironmentErrorsDonut from "./components/EnvironmentErrorsDonut.vue";
import HeatmapView from "../popup/components/HeatmapView.vue";
import { useWarRoomPeriod } from "./composables/useWarRoomPeriod";
import {
  buildEnvironmentHostStats,
  buildEnvironmentProblemSlices,
  filterProblemsByPeriod,
} from "./utils/warRoomStats";

type CenterView = "timeline" | "network";

const selectedProblem = ref<ZabbixProblem | undefined>();
const centerView = ref<CenterView>("timeline");

const {
  slidingWindow,
  timeStartSec,
  timeEndSec,
  startInput,
  endInput,
  useLastHours,
  onAutoRefresh,
} = useWarRoomPeriod();

const { data: prefs } = useQuery({
  queryKey: ["warroom-prefs"],
  queryFn: () => sendBackground<AppPrefs>("getPrefs"),
});

const refreshMs = computed(() => (prefs.value?.warRoomRefreshSec ?? 15) * 1000);

const { data: controllers, refetch: refetchControllers } = useQuery({
  queryKey: ["warroom-controllers"],
  queryFn: () => sendBackground<ControllerInfo[]>("getControllers"),
  refetchInterval: () => {
    onAutoRefresh();
    return refreshMs.value;
  },
});

const { data: infrastructure, refetch: refetchInfrastructure } = useQuery({
  queryKey: ["warroom-infrastructure"],
  queryFn: () => sendBackground<InfraEnvironmentNode[]>("getInfrastructure"),
  refetchInterval: () => {
    onAutoRefresh();
    return refreshMs.value;
  },
});

const allProblems = computed<ZabbixProblem[]>(() =>
  (controllers.value ?? []).flatMap((c) => c.problems),
);

const filteredProblems = computed(() =>
  filterProblemsByPeriod(
    allProblems.value,
    timeStartSec.value,
    timeEndSec.value,
  ),
);

const environmentStats = computed(() =>
  buildEnvironmentHostStats(infrastructure.value ?? [], filteredProblems.value),
);

const environmentSlices = computed(() =>
  buildEnvironmentProblemSlices(filteredProblems.value),
);

function envLabel(id: string): string {
  return environmentLabelById(id, prefs.value?.environments ?? []);
}

async function refreshAll(): Promise<void> {
  onAutoRefresh();
  await Promise.all([refetchControllers(), refetchInfrastructure()]);
}

async function checkNow(): Promise<void> {
  const ctrls = controllers.value ?? [];
  await Promise.all(ctrls.map((c) => sendBackground("checkNow", c.id)));
  await refreshAll();
}

function onSelectProblem(problem: ZabbixProblem): void {
  selectedProblem.value = problem;
}

const showNetworkGraph = computed({
  get: () => centerView.value === "network",
  set: (value: boolean) => {
    centerView.value = value ? "network" : "timeline";
  },
});

let unsubscribe: (() => void) | undefined;

onMounted(() => {
  unsubscribe = onBackgroundRefresh(() => refreshAll());
  document.documentElement.requestFullscreen?.().catch(() => undefined);
});

onUnmounted(() => {
  unsubscribe?.();
});
</script>

<template>
  <div class="flex h-screen flex-col bg-slate-950 p-4 text-slate-100">
    <header class="mb-4 shrink-0 border-b border-slate-800 pb-3">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-2xl font-bold tracking-tight text-white">
            {{ i18n("warroom_title") }}
          </h1>
          <p class="text-sm text-slate-400">{{ i18n("warroom_subtitle") }}</p>
        </div>

        <div class="flex flex-wrap items-end gap-2">
          <div
            class="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900/60 px-1 py-1"
            role="group"
            :aria-label="i18n('warroom_view_switch')"
          >
            <span
              class="text-xs font-medium transition-colors"
              :class="
                centerView === 'timeline' ? 'text-white' : 'text-slate-500'
              "
            >
              {{ i18n("warroom_timeline") }}
            </span>
            <button
              type="button"
              role="switch"
              :aria-checked="showNetworkGraph"
              class="relative inline-flex h-6 w-11 shrink-0 rounded-full bg-slate-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              :class="showNetworkGraph ? 'bg-sky-600' : 'bg-slate-700'"
              @click="showNetworkGraph = !showNetworkGraph"
            >
              <span
                class="pointer-events-none inline-block h-5 w-5 translate-y-0.5 rounded-full bg-white shadow transition-transform"
                :class="showNetworkGraph ? 'translate-x-5' : 'translate-x-0.5'"
              />
            </button>
            <span
              class="text-xs font-medium transition-colors"
              :class="
                centerView === 'network' ? 'text-white' : 'text-slate-500'
              "
            >
              {{ i18n("warroom_network_graph") }}
            </span>
          </div>
          <label class="flex flex-col gap-0.5 text-xs text-slate-400">
            {{ i18n("warroom_period_from") }}
            <input
              v-model="startInput"
              type="datetime-local"
              class="input text-xs"
            />
          </label>
          <label class="flex flex-col gap-0.5 text-xs text-slate-400">
            {{ i18n("warroom_period_to") }}
            <input
              v-model="endInput"
              type="datetime-local"
              class="input text-xs"
            />
          </label>
          <button
            type="button"
            class="btn btn-secondary text-xs"
            :class="slidingWindow ? 'ring-1 ring-sky-500' : ''"
            @click="useLastHours(6)"
          >
            {{ i18n("warroom_period_last_6h") }}
          </button>
          <button type="button" class="btn btn-secondary" @click="checkNow">
            ↻ {{ i18n("refresh") }}
          </button>
        </div>
      </div>
    </header>

    <div
      class="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(240px,1fr)_minmax(0,2fr)_minmax(240px,1fr)]"
    >
      <IncidentList
        :problems="filteredProblems"
        :selected-event-id="selectedProblem?.eventid"
        @select="onSelectProblem"
      />

      <div class="flex min-h-0 flex-col gap-2">
        <IncidentTimeline
          v-if="centerView === 'timeline'"
          :problems="filteredProblems"
          :highlight-event-id="selectedProblem?.eventid"
          :time-start-sec="timeStartSec"
          :time-end-sec="timeEndSec"
        />
        <EnvironmentNetworkGraph
          v-else
          :stats="environmentStats"
          :env-label="envLabel"
        />
      </div>

      <div>
        <EnvironmentErrorsDonut
          :slices="environmentSlices"
          :env-label="envLabel"
        />
        <section class="card flex h-full flex-col overflow-hidden">
          <h2 class="mb-2 shrink-0 text-lg font-semibold">
            {{ i18n("tab_heatmap") }}
          </h2>
          <div class="min-h-0 flex-1 overflow-y-auto">
            <HeatmapView :problems="filteredProblems" />
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

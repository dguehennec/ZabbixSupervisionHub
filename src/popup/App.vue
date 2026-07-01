<script setup lang="ts">
import { ref } from "vue";
import { i18n, sendBackground } from "@/ui/rpc";
import { useControllers } from "./composables/useControllers";
import { Constants } from "../modules/constant/constants";
import DashboardView from "./components/DashboardView.vue";
import ProblemsView from "./components/ProblemsView.vue";
import HeatmapView from "./components/HeatmapView.vue";
import InfrastructureView from "./components/InfrastructureView.vue";

type TabId = "dashboard" | "problems" | "heatmap" | "infra";

const activeTab = ref<TabId>("dashboard");
const { controllers, allProblems, refreshAll, checkNow } = useControllers();

const tabs: { id: TabId; labelKey: string }[] = [
  { id: "dashboard", labelKey: "tab_dashboard" },
  { id: "problems", labelKey: "tab_problems" },
  { id: "heatmap", labelKey: "tab_heatmap" },
  { id: "infra", labelKey: "tab_infrastructure" },
];

const donateUrl = Constants.DONATE_URL;
const extensionVersion = chrome.runtime.getManifest().version;

function openOptions(): void {
  chrome.runtime.openOptionsPage();
}

function openWarRoom(): void {
  sendBackground("openWarRoom");
}

</script>

<template>
  <div class="flex w-[480px] flex-col" style="min-height: 600px">
    <header class="shrink-0 border-b border-slate-700 p-3">
      <div class="mb-2 flex items-center justify-between">
        <div>
          <h1 class="text-base font-bold text-white">
            {{ i18n("popup_title") }}
          </h1>
          <p class="text-xs text-slate-400">{{ i18n("popup_subtitle") }}</p>
        </div>
        <div class="flex gap-1">
          <button
            class="btn btn-secondary"
            :title="i18n('warroom_open')"
            @click="openWarRoom"
          >
            ⛶
          </button>
          <button
            class="btn btn-secondary"
            :title="i18n('refresh')"
            @click="checkNow"
          >
            ↻
          </button>
          <button
            class="btn btn-secondary"
            :title="i18n('options')"
            @click="openOptions"
          >
            ⚙
          </button>
        </div>
      </div>

      <nav class="flex gap-1">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="flex-1 rounded px-1 py-1.5 text-[11px] font-medium transition-colors"
          :class="
            activeTab === tab.id
              ? 'bg-blue-600 text-white'
              : 'bg-slate-800 text-slate-400 hover:text-white'
          "
          @click="activeTab = tab.id"
        >
          {{ i18n(tab.labelKey) }}
        </button>
      </nav>
    </header>

    <main class="flex-1 overflow-y-auto p-3">
      <DashboardView v-if="activeTab === 'dashboard'" :problems="allProblems" />
      <ProblemsView
        v-else-if="activeTab === 'problems'"
        :problems="allProblems"
        :controllers="controllers ?? []"
        @refresh="refreshAll"
      />
      <HeatmapView v-else-if="activeTab === 'heatmap'" />
      <InfrastructureView v-else-if="activeTab === 'infra'" />
    </main>

    <footer class="shrink-0 border-t border-slate-800 bg-slate-900/80 px-3 py-2 text-center">
      <a
        :href="donateUrl"
        target="_blank"
        rel="noopener noreferrer"
        class="popup-donate-link"
      >
        ☕ {{ i18n("about_donate") }}
      </a>
      <p class="mt-1 text-[10px] text-slate-600">
        {{ i18n("about_version_label") }} {{ extensionVersion }}
      </p>
    </footer>
  </div>
</template>

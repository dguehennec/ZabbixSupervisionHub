<script setup lang="ts">
import { onMounted, ref } from "vue";
import type {
  AppPrefs,
  ZabbixInstanceConfig,
  FilterPreset,
  EnvironmentHostGroupRule,
  EnvironmentDefinition,
  ControllerInfo,
  ProblemTitleHideRule,
} from "../types";
import { ZabbixAuthMethod, ZabbixSeverity } from "../types";
import { sendBackground, i18n } from "../ui/rpc";
import {
  requestOriginPermission,
  randomHex,
  severityLabel,
} from "../modules/service/Util";
import {
  BUILTIN_ENVIRONMENT_IDS,
  environmentLabel,
  normalizeEnvironments,
  sanitizeEnvironmentRules,
  slugifyEnvironmentId,
} from "../modules/service/Environments";
import {
  isInvalidTitleHidePattern,
  normalizeTitleHideRules,
} from "../modules/service/ProblemTitleFilters";
import { Constants } from "../modules/constant/constants";
import { extensionAssetUrl } from "../modules/service/BrowserService";

type OptionsSection =
  | "instances"
  | "environments"
  | "filters"
  | "general"
  | "about";

const prefs = ref<AppPrefs | null>(null);
const instances = ref<ZabbixInstanceConfig[]>([]);
const selectedId = ref<string>("");
const editForm = ref<Partial<ZabbixInstanceConfig>>({});
const password = ref("");
const apiToken = ref("");
const testResult = ref("");
const testError = ref("");
const saving = ref(false);
const envRules = ref<EnvironmentHostGroupRule[]>([]);
const environmentsList = ref<EnvironmentDefinition[]>([]);
const knownHostGroups = ref<string[]>([]);
const envRulesSaving = ref(false);
const environmentsSaving = ref(false);
const titleHideRules = ref<ProblemTitleHideRule[]>([]);
const titleHideRulesSaving = ref(false);
const titleHideRulesError = ref("");

const activeSection = ref<OptionsSection>("instances");
const donateUrl = Constants.DONATE_URL;
const appIconUrl = extensionAssetUrl("skin/images/zabbix_hub_48.png");
const extensionVersion = chrome.runtime.getManifest().version;

const navItems: { id: OptionsSection; labelKey: string; icon: string }[] = [
  { id: "general", labelKey: "general_settings", icon: "⚙" },
  { id: "instances", labelKey: "options_nav_instances", icon: "🖥" },
  { id: "environments", labelKey: "options_nav_environments", icon: "🏷" },
  { id: "filters", labelKey: "options_nav_filters", icon: "🔍" },
  { id: "about", labelKey: "options_nav_about", icon: "ℹ" },
];

const authMethodOptions = Object.values(ZabbixAuthMethod);
const severityOptions = [
  ZabbixSeverity.NOT_CLASSIFIED,
  ZabbixSeverity.INFORMATION,
  ZabbixSeverity.WARNING,
  ZabbixSeverity.AVERAGE,
  ZabbixSeverity.HIGH,
  ZabbixSeverity.DISASTER,
];

function isApiTokenAuth(): boolean {
  return editForm.value.authMethod === ZabbixAuthMethod.API_TOKEN;
}

async function load(): Promise<void> {
  const p = await sendBackground<AppPrefs>("getPrefs");
  prefs.value = p;
  instances.value = [...p.instances];
  envRules.value = (p.environmentHostGroupRules ?? []).map((r) => ({ ...r }));
  environmentsList.value = normalizeEnvironments(p.environments ?? []).map(
    (e) => ({ ...e }),
  );
  titleHideRules.value = (p.problemTitleHideRules ?? []).map((r) => ({ ...r }));
  knownHostGroups.value = await sendBackground<string[]>("getKnownHostGroups");
  if (!selectedId.value && instances.value.length) {
    selectInstance(instances.value[0].id);
  }
}

function selectInstance(id: string): void {
  selectedId.value = id;
  const inst = instances.value.find((i) => i.id === id);
  editForm.value = inst ? { ...inst } : {};
  password.value = "";
  apiToken.value = "";
  testResult.value = "";
  testError.value = "";
}

async function addInstance(): Promise<void> {
  const id = await sendBackground<string>("addNewInstance");
  await load();
  selectInstance(id);
}

async function saveInstance(): Promise<void> {
  if (!selectedId.value) return;
  saving.value = true;
  try {
    await sendBackground("updateInstance", selectedId.value, editForm.value);
    if (isApiTokenAuth()) {
      if (apiToken.value) {
        await sendBackground("saveApiToken", selectedId.value, apiToken.value);
        editForm.value.saveApiToken = true;
      }
    } else if (password.value) {
      await sendBackground("savePassword", selectedId.value, password.value);
      editForm.value.savePassword = true;
      await sendBackground("updateInstance", selectedId.value, {
        savePassword: true,
      });
    }
    await load();
    testResult.value = i18n("saved");
  } finally {
    saving.value = false;
  }
}

async function deleteInstance(): Promise<void> {
  if (!selectedId.value || !confirm(i18n("confirm_delete_instance"))) return;
  await sendBackground("removeController", selectedId.value);
  selectedId.value = "";
  editForm.value = {};
  await load();
}

async function testConnection(): Promise<void> {
  testResult.value = "";
  testError.value = "";
  if (!editForm.value.apiUrl) {
    testError.value = i18n("error_missing_api_url");
    return;
  }
  const authMethod = editForm.value.authMethod ?? ZabbixAuthMethod.PASSWORD;
  if (authMethod === ZabbixAuthMethod.PASSWORD && !editForm.value.username) {
    testError.value = i18n("error_missing_fields");
    return;
  }
  if (authMethod === ZabbixAuthMethod.API_TOKEN && !apiToken.value) {
    testError.value = i18n("error_api_token_not_set");
    return;
  }
  if (authMethod === ZabbixAuthMethod.PASSWORD && !password.value) {
    testError.value = i18n("error_password_not_set");
    return;
  }
  const granted = await requestOriginPermission(editForm.value.apiUrl);
  if (granted) {
    try {
      const secret =
        authMethod === ZabbixAuthMethod.API_TOKEN
          ? apiToken.value
          : password.value;
      const result = await sendBackground<{ version: string }>(
        "testConnection",
        editForm.value.apiUrl,
        authMethod,
        editForm.value.username ?? "",
        secret,
      );
      testResult.value = i18n("test_success", result.version);
    } catch (e) {
      testError.value = e instanceof Error ? e.message : i18n("test_failed");
    }
  }
}

async function connectInstance(): Promise<void> {
  if (!selectedId.value) return;
  if (isApiTokenAuth()) {
    if (apiToken.value) {
      await sendBackground("saveApiToken", selectedId.value, apiToken.value);
    }
    await sendBackground(
      "initializeConnection",
      selectedId.value,
      apiToken.value || undefined,
    );
  } else {
    if (password.value) {
      await sendBackground("savePassword", selectedId.value, password.value);
    }
    await sendBackground(
      "initializeConnection",
      selectedId.value,
      password.value || undefined,
    );
  }
  testResult.value = i18n("connecting");
}

async function disconnectInstance(): Promise<void> {
  if (!selectedId.value) return;
  await sendBackground("closeConnection", selectedId.value);
}

async function updatePref<K extends keyof AppPrefs>(
  key: K,
  value: AppPrefs[K],
): Promise<void> {
  await sendBackground("updatePref", key, value);
  await load();
}

async function updateHostFilterPref<
  K extends
    | "excludeDisabledHosts"
    | "excludeMaintenanceHosts"
    | "excludeDisabledTriggers",
>(key: K, value: AppPrefs[K]): Promise<void> {
  await sendBackground("updatePref", key, value);
  const controllers = await sendBackground<ControllerInfo[]>("getControllers");
  await Promise.all(controllers.map((c) => sendBackground("checkNow", c.id)));
  await load();
}

async function deletePreset(preset: FilterPreset): Promise<void> {
  if (!confirm(i18n("confirm_delete_preset"))) return;
  await sendBackground("deleteFilterPreset", preset.id);
  await load();
}

function moveInList<T>(list: T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const copy = [...list];
  const [item] = copy.splice(index, 1);
  copy.splice(target, 0, item);
  return copy;
}

function prepareEnvironmentsForSave(): EnvironmentDefinition[] {
  const reservedIds = new Set<string>(Object.values(BUILTIN_ENVIRONMENT_IDS));
  const idMigration = new Map<string, string>();
  const customPrepared: EnvironmentDefinition[] = [];

  for (const env of environmentsList.value) {
    if (env.builtin) continue;
    const label = env.label.trim();
    if (!label) continue;
    const id = env.id.startsWith("draft_")
      ? slugifyEnvironmentId(label, reservedIds)
      : env.id;
    if (env.id !== id) idMigration.set(env.id, id);
    reservedIds.add(id);
    customPrepared.push({
      id,
      label,
      builtin: false,
      hidden: env.hidden === true,
    });
  }

  if (idMigration.size) {
    envRules.value = envRules.value.map((rule) => ({
      ...rule,
      environmentId: idMigration.get(rule.environmentId) ?? rule.environmentId,
    }));
  }

  const builtins = environmentsList.value.filter((e) => e.builtin);
  return normalizeEnvironments([...customPrepared, ...builtins]);
}

function canMoveEnvironment(index: number, delta: -1 | 1): boolean {
  const env = environmentsList.value[index];
  if (!env || env.builtin) return false;
  const target = index + delta;
  if (target < 0 || target >= environmentsList.value.length) return false;
  return !environmentsList.value[target]?.builtin;
}

function moveEnvironment(index: number, delta: -1 | 1): void {
  if (!canMoveEnvironment(index, delta)) return;
  environmentsList.value = moveInList(environmentsList.value, index, delta);
}

function moveEnvironmentRule(index: number, delta: -1 | 1): void {
  const target = index + delta;
  if (target < 0 || target >= envRules.value.length) return;
  envRules.value = moveInList(envRules.value, index, delta);
}

function addEnvironmentRule(): void {
  const defaultEnvId =
    environmentsList.value.find((e) => e.id !== BUILTIN_ENVIRONMENT_IDS.HIDE)
      ?.id ?? BUILTIN_ENVIRONMENT_IDS.OTHER;
  envRules.value.push({
    id: randomHex(8),
    hostGroupName: "",
    environmentId: defaultEnvId,
  });
}

function addEnvironment(): void {
  environmentsList.value.push({
    id: `draft_${randomHex(8)}`,
    label: "",
    builtin: false,
    hidden: false,
  });
}

function removeEnvironment(id: string): void {
  const env = environmentsList.value.find((e) => e.id === id);
  if (!env || env.builtin) return;
  environmentsList.value = environmentsList.value.filter((e) => e.id !== id);
  envRules.value = envRules.value.map((rule) =>
    rule.environmentId === id
      ? { ...rule, environmentId: BUILTIN_ENVIRONMENT_IDS.OTHER }
      : rule,
  );
}

async function saveEnvironments(): Promise<void> {
  environmentsSaving.value = true;
  try {
    const environments = prepareEnvironmentsForSave();
    await sendBackground("updatePref", "environments", environments);
    const rules = sanitizeEnvironmentRules(envRules.value, environments);
    await sendBackground("updatePref", "environmentHostGroupRules", rules);
    const controllers =
      await sendBackground<ControllerInfo[]>("getControllers");
    await Promise.all(controllers.map((c) => sendBackground("checkNow", c.id)));
    await load();
    testResult.value = i18n("environments_saved");
    testError.value = "";
  } finally {
    environmentsSaving.value = false;
  }
}

async function saveEnvironmentRules(): Promise<void> {
  envRulesSaving.value = true;
  try {
    const environments = normalizeEnvironments(
      environmentsList.value.filter((e) => e.builtin || e.label.trim()),
    );
    const rules = sanitizeEnvironmentRules(
      envRules.value
        .map((r) => ({
          ...r,
          hostGroupName: r.hostGroupName.trim(),
        }))
        .filter((r) => r.hostGroupName.length > 0),
      environments,
    );
    await sendBackground("updatePref", "environmentHostGroupRules", rules);
    const controllers =
      await sendBackground<ControllerInfo[]>("getControllers");
    await Promise.all(controllers.map((c) => sendBackground("checkNow", c.id)));
    await load();
    testResult.value = i18n("environment_rules_saved");
    testError.value = "";
  } finally {
    envRulesSaving.value = false;
  }
}

function removeEnvironmentRule(id: string): void {
  envRules.value = envRules.value.filter((r) => r.id !== id);
}

function addTitleHideRule(): void {
  titleHideRules.value.push({
    id: randomHex(8),
    pattern: "",
  });
}

function removeTitleHideRule(id: string): void {
  titleHideRules.value = titleHideRules.value.filter((r) => r.id !== id);
}

async function saveTitleHideRules(): Promise<void> {
  titleHideRulesError.value = "";
  const invalid = titleHideRules.value.filter((r) =>
    isInvalidTitleHidePattern(r.pattern),
  );
  if (invalid.length) {
    titleHideRulesError.value = i18n("title_hide_rules_invalid");
    return;
  }

  titleHideRulesSaving.value = true;
  try {
    const rules = normalizeTitleHideRules(titleHideRules.value);
    await sendBackground("updatePref", "problemTitleHideRules", rules);
    const controllers =
      await sendBackground<ControllerInfo[]>("getControllers");
    await Promise.all(controllers.map((c) => sendBackground("checkNow", c.id)));
    await load();
    testResult.value = i18n("title_hide_rules_saved");
    testError.value = "";
  } finally {
    titleHideRulesSaving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="options-layout">
    <aside class="options-sidebar">
      <div class="options-sidebar-brand">
        <img :src="appIconUrl" alt="" class="h-8 w-8 shrink-0" />
        <span>{{ i18n("extName") }}</span>
      </div>

      <nav class="options-sidebar-nav">
        <button
          v-for="item in navItems"
          :key="item.id"
          type="button"
          class="options-nav-item"
          :class="{ active: activeSection === item.id }"
          @click="activeSection = item.id"
        >
          <span aria-hidden="true">{{ item.icon }}</span>
          <span>{{ i18n(item.labelKey) }}</span>
        </button>
      </nav>

      <div class="options-sidebar-donate">
        <a
          :href="donateUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-donate"
        >
          ☕ {{ i18n("about_donate") }}
        </a>
        <p class="donate-msg">{{ i18n("extDescription") }}</p>
      </div>
    </aside>

    <main class="options-main">
      <div v-show="activeSection === 'instances'">
        <h2 class="options-panel-title">{{ i18n("options_nav_instances") }}</h2>

        <section class="mb-8">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-lg font-semibold">
              {{ i18n("instances_section") }}
            </h2>
            <button class="btn btn-primary" @click="addInstance">
              + {{ i18n("add_instance") }}
            </button>
          </div>

          <div class="grid gap-4 md:grid-cols-[220px_1fr]">
            <aside class="card space-y-1 p-2">
              <button
                v-for="inst in instances"
                :key="inst.id"
                class="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-800"
                :class="
                  selectedId === inst.id
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-300'
                "
                @click="selectInstance(inst.id)"
              >
                {{ inst.alias || inst.username || inst.id.slice(0, 8) }}
              </button>
              <p v-if="!instances.length" class="p-2 text-xs text-slate-500">
                {{ i18n("no_instances") }}
              </p>
            </aside>

            <div v-if="selectedId" class="card space-y-3">
              <div class="grid gap-3 md:grid-cols-2">
                <div>
                  <label class="label">{{ i18n("field_alias") }}</label>
                  <input v-model="editForm.alias" class="input" />
                </div>
                <div class="md:col-span-2">
                  <label class="label">{{ i18n("field_api_url") }}</label>
                  <input
                    v-model="editForm.apiUrl"
                    class="input"
                    placeholder="https://zabbix.example.com/api_jsonrpc.php"
                  />
                </div>
                <div class="md:col-span-2">
                  <label class="label">{{ i18n("field_web_url") }}</label>
                  <input
                    v-model="editForm.webUrl"
                    class="input"
                    placeholder="https://zabbix.example.com"
                  />
                </div>
                <div class="md:col-span-2">
                  <label class="label">{{ i18n("field_auth_method") }}</label>
                  <select v-model="editForm.authMethod" class="input max-w-md">
                    <option
                      v-for="method in authMethodOptions"
                      :key="method"
                      :value="method"
                    >
                      {{ i18n(`auth_method_${method}`) }}
                    </option>
                  </select>
                </div>
                <div v-if="!isApiTokenAuth()">
                  <label class="label">{{ i18n("field_username") }}</label>
                  <input v-model="editForm.username" class="input" />
                </div>
                <div v-if="!isApiTokenAuth()">
                  <label class="label">{{ i18n("field_password") }}</label>
                  <input
                    v-model="password"
                    class="input"
                    type="password"
                    :placeholder="i18n('password_placeholder')"
                  />
                </div>
                <div v-if="isApiTokenAuth()" class="md:col-span-2">
                  <label class="label">{{ i18n("field_api_token") }}</label>
                  <input
                    v-model="apiToken"
                    class="input font-mono text-sm"
                    type="password"
                    autocomplete="off"
                    :placeholder="i18n('api_token_placeholder')"
                  />
                  <p class="mt-1 text-xs text-slate-500">
                    {{ i18n("api_token_hint") }}
                  </p>
                </div>
              </div>

              <label class="flex items-center gap-2 text-sm text-slate-300">
                <input
                  v-model="editForm.enabled"
                  type="checkbox"
                  class="rounded"
                />
                {{ i18n("field_enabled") }}
              </label>

              <div class="flex flex-wrap gap-2">
                <button
                  class="btn btn-primary"
                  :disabled="saving"
                  @click="saveInstance"
                >
                  {{ i18n("save") }}
                </button>
                <button class="btn btn-secondary" @click="testConnection">
                  {{ i18n("test_connection") }}
                </button>
                <button class="btn btn-secondary" @click="connectInstance">
                  {{ i18n("connect") }}
                </button>
                <button class="btn btn-secondary" @click="disconnectInstance">
                  {{ i18n("disconnect") }}
                </button>
                <button class="btn btn-danger" @click="deleteInstance">
                  {{ i18n("delete") }}
                </button>
              </div>

              <p v-if="testResult" class="text-sm text-emerald-400">
                {{ testResult }}
              </p>
              <p v-if="testError" class="text-sm text-red-400">
                {{ testError }}
              </p>
            </div>
          </div>
        </section>
      </div>

      <div v-show="activeSection === 'environments'">
        <h2 class="options-panel-title">
          {{ i18n("options_nav_environments") }}
        </h2>

        <section class="card mb-8 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-lg font-semibold">
                {{ i18n("environments_section") }}
              </h2>
              <p class="text-sm text-slate-400">
                {{ i18n("environments_hint") }}
              </p>
            </div>
            <button
              class="btn btn-secondary"
              type="button"
              @click="addEnvironment"
            >
              + {{ i18n("add_environment") }}
            </button>
          </div>

          <p
            v-if="!environmentsList.some((e) => !e.builtin)"
            class="text-sm text-slate-500"
          >
            {{ i18n("no_custom_environments") }}
          </p>

          <ul class="space-y-2">
            <li
              v-for="(env, index) in environmentsList"
              :key="env.id"
              class="flex flex-wrap items-center gap-2 rounded bg-slate-800 p-3"
            >
              <div class="flex shrink-0 flex-col gap-0.5">
                <button
                  class="btn btn-secondary px-1.5 py-0.5 text-xs leading-none"
                  type="button"
                  :title="i18n('move_up')"
                  :disabled="!canMoveEnvironment(index, -1)"
                  @click="moveEnvironment(index, -1)"
                >
                  ↑
                </button>
                <button
                  class="btn btn-secondary px-1.5 py-0.5 text-xs leading-none"
                  type="button"
                  :title="i18n('move_down')"
                  :disabled="!canMoveEnvironment(index, 1)"
                  @click="moveEnvironment(index, 1)"
                >
                  ↓
                </button>
              </div>
              <input
                v-model="env.label"
                class="input min-w-[140px] flex-1"
                :placeholder="i18n('field_environment_label_placeholder')"
                :disabled="
                  (env.builtin && env.id === BUILTIN_ENVIRONMENT_IDS.OTHER) ||
                  env.hidden
                "
              />
              <span v-if="env.builtin" class="text-xs text-slate-500">{{
                i18n("environment_builtin")
              }}</span>
              <span v-if="env.hidden" class="text-xs text-amber-400">{{
                i18n("environment_hidden_badge")
              }}</span>
              <button
                v-if="!env.builtin"
                class="btn btn-danger text-xs"
                type="button"
                @click="removeEnvironment(env.id)"
              >
                {{ i18n("delete") }}
              </button>
            </li>
          </ul>

          <p class="text-xs text-slate-500">
            {{ i18n("environment_hidden_hint") }}
          </p>

          <button
            class="btn btn-primary"
            type="button"
            :disabled="environmentsSaving"
            @click="saveEnvironments"
          >
            {{ i18n("save_environments") }}
          </button>
        </section>

        <section class="card mb-8 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-lg font-semibold">
                {{ i18n("environment_hostgroups_section") }}
              </h2>
              <p class="text-sm text-slate-400">
                {{ i18n("environment_hostgroups_hint") }}
              </p>
            </div>
            <button
              class="btn btn-secondary"
              type="button"
              @click="addEnvironmentRule"
            >
              + {{ i18n("add_environment_rule") }}
            </button>
          </div>

          <p v-if="!envRules.length" class="text-sm text-slate-500">
            {{ i18n("no_environment_rules") }}
          </p>

          <ul v-else class="space-y-2">
            <li
              v-for="(rule, index) in envRules"
              :key="rule.id"
              class="grid gap-2 rounded bg-slate-800 p-3 md:grid-cols-[auto_1fr_180px_auto]"
            >
              <div class="flex flex-col gap-0.5 self-end pb-0.5">
                <button
                  class="btn btn-secondary px-1.5 py-0.5 text-xs leading-none"
                  type="button"
                  :title="i18n('move_up')"
                  :disabled="index === 0"
                  @click="moveEnvironmentRule(index, -1)"
                >
                  ↑
                </button>
                <button
                  class="btn btn-secondary px-1.5 py-0.5 text-xs leading-none"
                  type="button"
                  :title="i18n('move_down')"
                  :disabled="index === envRules.length - 1"
                  @click="moveEnvironmentRule(index, 1)"
                >
                  ↓
                </button>
              </div>
              <div>
                <label class="label">{{ i18n("field_hostgroup_name") }}</label>
                <input
                  v-model="rule.hostGroupName"
                  class="input"
                  :placeholder="i18n('field_hostgroup_name_placeholder')"
                  list="known-hostgroups"
                />
              </div>
              <div>
                <label class="label">{{ i18n("field_environment") }}</label>
                <select v-model="rule.environmentId" class="input">
                  <option
                    v-for="env in environmentsList"
                    :key="env.id"
                    :value="env.id"
                  >
                    {{ environmentLabel(env) }}
                  </option>
                </select>
              </div>
              <div class="flex items-center">
                <button
                  class="btn btn-danger"
                  type="button"
                  @click="removeEnvironmentRule(rule.id)"
                >
                  {{ i18n("delete") }}
                </button>
              </div>
            </li>
          </ul>

          <datalist id="known-hostgroups">
            <option v-for="name in knownHostGroups" :key="name" :value="name" />
          </datalist>

          <p class="text-xs text-slate-500">
            {{ i18n("environment_default_other") }}
          </p>

          <button
            class="btn btn-primary"
            type="button"
            :disabled="envRulesSaving"
            @click="saveEnvironmentRules"
          >
            {{ i18n("save_environment_rules") }}
          </button>
        </section>
      </div>

      <div v-show="activeSection === 'filters'">
        <h2 class="options-panel-title">{{ i18n("options_nav_filters") }}</h2>

        <section class="card mb-8 space-y-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 class="text-lg font-semibold">
                {{ i18n("title_hide_rules_section") }}
              </h2>
              <p class="text-sm text-slate-400">
                {{ i18n("title_hide_rules_hint") }}
              </p>
            </div>
            <button
              class="btn btn-secondary"
              type="button"
              @click="addTitleHideRule"
            >
              + {{ i18n("add_title_hide_rule") }}
            </button>
          </div>

          <p v-if="!titleHideRules.length" class="text-sm text-slate-500">
            {{ i18n("no_title_hide_rules") }}
          </p>

          <ul v-else class="space-y-2">
            <li
              v-for="rule in titleHideRules"
              :key="rule.id"
              class="flex flex-wrap items-start gap-2 rounded bg-slate-800 p-3"
            >
              <div class="min-w-0 flex-1">
                <label class="label">{{ i18n("field_title_regex") }}</label>
                <input
                  v-model="rule.pattern"
                  class="input font-mono text-sm"
                  :class="{
                    'border-red-500': isInvalidTitleHidePattern(rule.pattern),
                  }"
                  :placeholder="i18n('field_title_regex_placeholder')"
                />
                <p
                  v-if="isInvalidTitleHidePattern(rule.pattern)"
                  class="mt-1 text-xs text-red-400"
                >
                  {{ i18n("title_hide_rule_invalid") }}
                </p>
              </div>
              <button
                class="btn btn-danger mt-6"
                type="button"
                @click="removeTitleHideRule(rule.id)"
              >
                {{ i18n("delete") }}
              </button>
            </li>
          </ul>

          <p class="text-xs text-slate-500">
            {{ i18n("title_hide_rules_footer") }}
          </p>
          <p v-if="titleHideRulesError" class="text-sm text-red-400">
            {{ titleHideRulesError }}
          </p>

          <button
            class="btn btn-primary"
            type="button"
            :disabled="titleHideRulesSaving"
            @click="saveTitleHideRules"
          >
            {{ i18n("save_title_hide_rules") }}
          </button>
        </section>

        <section v-if="prefs" class="card mb-8 space-y-3">
          <h2 class="text-lg font-semibold">
            {{ i18n("filter_presets_section") }}
          </h2>
          <p v-if="!prefs.filterPresets?.length" class="text-sm text-slate-500">
            {{ i18n("no_filter_presets") }}
          </p>
          <ul v-else class="space-y-2">
            <li
              v-for="preset in prefs.filterPresets"
              :key="preset.id"
              class="flex items-center justify-between rounded bg-slate-800 px-3 py-2 text-sm"
            >
              <span class="text-white">★ {{ preset.name }}</span>
              <button
                class="btn btn-danger text-xs"
                @click="deletePreset(preset)"
              >
                {{ i18n("delete") }}
              </button>
            </li>
          </ul>
          <p class="text-xs text-slate-500">
            {{ i18n("save_filter") }} — {{ i18n("tab_problems") }}
          </p>
        </section>
      </div>

      <div v-if="prefs" v-show="activeSection === 'general'">
        <h2 class="options-panel-title">{{ i18n("general_settings") }}</h2>

        <section class="card space-y-3">
          <label class="flex items-center gap-2 text-sm">
            <input
              :checked="prefs.autoConnect"
              type="checkbox"
              @change="
                updatePref(
                  'autoConnect',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            {{ i18n("auto_connect") }}
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              :checked="prefs.problemNotificationEnabled"
              type="checkbox"
              @change="
                updatePref(
                  'problemNotificationEnabled',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            {{ i18n("notifications_enabled") }}
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              :checked="prefs.problemSoundEnabled"
              type="checkbox"
              @change="
                updatePref(
                  'problemSoundEnabled',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            {{ i18n("sound_enabled") }}
          </label>
          <div class="border-t border-slate-700 pt-3">
            <h3 class="mb-2 text-sm font-semibold text-slate-300">
              {{ i18n("hosts_filter_section") }}
            </h3>
            <label class="mb-2 flex items-center gap-2 text-sm">
              <input
                :checked="prefs.excludeDisabledHosts"
                type="checkbox"
                @change="
                  updateHostFilterPref(
                    'excludeDisabledHosts',
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              {{ i18n("exclude_disabled_hosts") }}
            </label>
            <label class="mb-2 flex items-center gap-2 text-sm">
              <input
                :checked="prefs.excludeMaintenanceHosts"
                type="checkbox"
                @change="
                  updateHostFilterPref(
                    'excludeMaintenanceHosts',
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              {{ i18n("exclude_maintenance_hosts") }}
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input
                :checked="prefs.excludeDisabledTriggers"
                type="checkbox"
                @change="
                  updateHostFilterPref(
                    'excludeDisabledTriggers',
                    ($event.target as HTMLInputElement).checked,
                  )
                "
              />
              {{ i18n("exclude_disabled_triggers") }}
            </label>
            <p class="mt-1 text-xs text-slate-500">
              {{ i18n("hosts_filter_hint") }}
            </p>
          </div>
          <div>
            <label class="label">{{ i18n("min_severity_display") }}</label>
            <select
              :value="prefs.minSeverityDisplay"
              class="input max-w-md"
              @change="
                updatePref(
                  'minSeverityDisplay',
                  Number(
                    ($event.target as HTMLSelectElement).value,
                  ) as ZabbixSeverity,
                )
              "
            >
              <option v-for="sev in severityOptions" :key="sev" :value="sev">
                {{ severityLabel(sev) }}
              </option>
            </select>
            <p class="mt-1 text-xs text-slate-500">
              {{ i18n("min_severity_display_hint") }}
            </p>
          </div>
          <div>
            <label class="label">{{ i18n("poll_interval") }}</label>
            <input
              :value="prefs.pollIntervalMs / 1000"
              class="input max-w-xs"
              type="number"
              min="15"
              @change="
                updatePref(
                  'pollIntervalMs',
                  Number(($event.target as HTMLInputElement).value) * 1000,
                )
              "
            />
          </div>
          <label class="flex items-center gap-2 text-sm">
            <input
              :checked="prefs.hideSnoozedProblems"
              type="checkbox"
              @change="
                updatePref(
                  'hideSnoozedProblems',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            {{ i18n("hide_snoozed") }}
          </label>
          <label class="flex items-center gap-2 text-sm">
            <input
              :checked="prefs.hideAcknowledgedProblems"
              type="checkbox"
              @change="
                updatePref(
                  'hideAcknowledgedProblems',
                  ($event.target as HTMLInputElement).checked,
                )
              "
            />
            {{ i18n("hide_acknowledged") }}
          </label>
          <p class="text-xs text-slate-500">
            {{ i18n("hide_acknowledged_hint") }}
          </p>
          <div>
            <label class="label">{{ i18n("warroom_refresh") }}</label>
            <input
              :value="prefs.warRoomRefreshSec"
              class="input max-w-xs"
              type="number"
              min="5"
              @change="
                updatePref(
                  'warRoomRefreshSec',
                  Number(($event.target as HTMLInputElement).value),
                )
              "
            />
          </div>
        </section>
      </div>

      <div v-show="activeSection === 'about'">
        <h2 class="options-panel-title">{{ i18n("options_nav_about") }}</h2>
        <section class="card mx-auto max-w-md space-y-4 p-6 text-center">
          <img :src="appIconUrl" alt="" class="mx-auto h-16 w-16" />
          <div>
            <h3 class="text-lg font-bold text-white">{{ i18n("extName") }}</h3>
            <p class="text-sm text-slate-400">
              {{ i18n("about_version_label") }} {{ extensionVersion }}
            </p>
          </div>
          <p class="text-sm leading-relaxed text-slate-400">
            {{ i18n("extDescription") }}
          </p>
          <a
            :href="donateUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-donate-inline"
          >
            ☕ {{ i18n("about_donate") }}
          </a>
          <p class="text-xs text-slate-500">{{ i18n("about_authors") }}</p>
        </section>
      </div>
    </main>
  </div>
</template>

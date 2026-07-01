// ============================================================
// modules/service/Prefs.ts
// ============================================================

import { AppPrefs, ZabbixInstanceConfig, FilterPreset, ZabbixAuthMethod } from '../../types';
import { Constants } from '../constant/constants';
import { Logger } from './Logger';
import { encryptPassword, decryptPassword } from './Crypto';
import {
  defaultEnvironments,
  normalizeEnvironments,
  normalizeEnvironmentRules,
  sanitizeEnvironmentRules,
} from './Environments';

const log = new Logger('Prefs');

const STORAGE_KEY = 'zsh_prefs';
const INSTANCES_KEY = 'zsh_instances';

const DEFAULT_PREFS: AppPrefs = {
  isFirstLaunch: true,
  previousVersion: 0,
  currentVersion: Constants.VERSION,
  autoConnect: Constants.DEFAULT_PREFS.AUTO_CONNECT,
  pollIntervalMs: Constants.DEFAULT_PREFS.POLL_INTERVAL_MS,
  problemNotificationEnabled: Constants.DEFAULT_PREFS.PROBLEM_NOTIFICATION_ENABLED,
  problemSoundEnabled: Constants.DEFAULT_PREFS.PROBLEM_SOUND_ENABLED,
  problemSoundVolume: Constants.DEFAULT_PREFS.PROBLEM_SOUND_VOLUME,
  problemNotificationDuration: Constants.DEFAULT_PREFS.PROBLEM_NOTIFICATION_DURATION,
  severitySoundMap: { ...Constants.DEFAULT_PREFS.SEVERITY_SOUND_MAP },
  minSeverityNotify: Constants.DEFAULT_PREFS.MIN_SEVERITY_NOTIFY,
  minSeverityDisplay: Constants.DEFAULT_PREFS.MIN_SEVERITY_DISPLAY,
  instances: [],
  filterPresets: [],
  favoriteHostIds: [],
  warRoomRefreshSec: Constants.DEFAULT_PREFS.WAR_ROOM_REFRESH_SEC,
  hideSnoozedProblems: Constants.DEFAULT_PREFS.HIDE_SNOOZED_PROBLEMS,
  hideAcknowledgedProblems: Constants.DEFAULT_PREFS.HIDE_ACKNOWLEDGED_PROBLEMS,
  environments: defaultEnvironments(),
  environmentHostGroupRules: [],
  problemTitleHideRules: [],
  excludeDisabledHosts: Constants.DEFAULT_PREFS.EXCLUDE_DISABLED_HOSTS,
  excludeMaintenanceHosts: Constants.DEFAULT_PREFS.EXCLUDE_MAINTENANCE_HOSTS,
  excludeDisabledTriggers: Constants.DEFAULT_PREFS.EXCLUDE_DISABLED_TRIGGERS,
};

let _cache: AppPrefs = { ...DEFAULT_PREFS };
let _loaded = false;
const _changeListeners: Array<() => void> = [];

function normalizeInstance(instance: ZabbixInstanceConfig): ZabbixInstanceConfig {
  return {
    ...instance,
    authMethod: instance.authMethod ?? ZabbixAuthMethod.PASSWORD,
    apiTokenEncrypted: instance.apiTokenEncrypted ?? '',
    saveApiToken: instance.saveApiToken ?? false,
  };
}

export const Prefs = {
  async load(): Promise<void> {
    try {
      const [syncResult, localResult] = await Promise.all([
        Prefs.getDefaultStorage().get(STORAGE_KEY),
        Prefs.getLocalStorage().get(INSTANCES_KEY),
      ]);
      const stored = (syncResult[STORAGE_KEY] ?? {}) as Partial<AppPrefs>;
      const instances =
        (localResult[INSTANCES_KEY] as ZabbixInstanceConfig[] | undefined) ??
        (stored.instances as ZabbixInstanceConfig[] | undefined) ??
        [];
      _cache = { ...DEFAULT_PREFS, ...stored, instances };
      _cache.environments = normalizeEnvironments(_cache.environments);
      _cache.environmentHostGroupRules = sanitizeEnvironmentRules(
        normalizeEnvironmentRules(_cache.environmentHostGroupRules),
        _cache.environments,
      );
      _cache.instances = _cache.instances.map(normalizeInstance);
      if (stored.isFirstLaunch || stored.previousVersion !== stored.currentVersion) {
        _cache.previousVersion = stored.currentVersion ?? 0;
      }

      _loaded = true;
      log.info('Prefs loaded', { version: _cache.currentVersion });
    } catch (e) {
      log.error('Failed to load prefs', e);
    }
  },

  async save(): Promise<void> {
    try {
      const { instances, ...rest } = _cache;
      await Promise.all([
        Prefs.getDefaultStorage().set({ [STORAGE_KEY]: rest }),
        Prefs.getLocalStorage().set({ [INSTANCES_KEY]: instances }),
      ]);
    } catch (e) {
      log.error('Failed to save prefs', e);
    }
  },

  isLoaded(): boolean {
    return _loaded;
  },

  get(): Readonly<AppPrefs> {
    return _cache;
  },

  async update<K extends keyof AppPrefs>(key: K, value: AppPrefs[K]): Promise<void> {
    _cache[key] = value;
    await Prefs.save();
    _changeListeners.forEach((fn) => fn());
  },

  onChange(fn: () => void): () => void {
    _changeListeners.push(fn);
    return () => {
      const i = _changeListeners.indexOf(fn);
      if (i >= 0) _changeListeners.splice(i, 1);
    };
  },

  getDefaultStorage(): chrome.storage.SyncStorageArea {
    return chrome.storage.sync ?? chrome.storage.local;
  },

  getLocalStorage(): chrome.storage.LocalStorageArea {
    return chrome.storage.local;
  },

  getInstances(): ZabbixInstanceConfig[] {
    return _cache.instances;
  },

  async addInstance(instance: ZabbixInstanceConfig): Promise<void> {
    _cache.instances = [..._cache.instances, normalizeInstance(instance)];
    await Prefs.save();
  },

  async removeInstance(instanceId: string): Promise<void> {
    _cache.instances = _cache.instances.filter((i) => i.id !== instanceId);
    await Prefs.save();
  },

  async updateInstance(instanceId: string, patch: Partial<ZabbixInstanceConfig>): Promise<void> {
    _cache.instances = _cache.instances.map((i) =>
      i.id === instanceId ? normalizeInstance({ ...i, ...patch }) : i,
    );
    await Prefs.save();
  },

  async saveApiToken(instanceId: string, apiToken: string | undefined): Promise<void> {
    if (apiToken) {
      const encrypted = await encryptPassword(apiToken);
      await Prefs.updateInstance(instanceId, { apiTokenEncrypted: encrypted, saveApiToken: true });
    } else {
      await Prefs.updateInstance(instanceId, { apiTokenEncrypted: '', saveApiToken: false });
    }
  },

  async loadApiToken(instanceId: string): Promise<string> {
    const instance = _cache.instances.find((i) => i.id === instanceId);
    if (!instance?.saveApiToken || !instance.apiTokenEncrypted) return '';
    return decryptPassword(instance.apiTokenEncrypted);
  },

  async savePassword(instanceId: string, password: string | undefined): Promise<void> {
    if (password) {
      const encrypted = await encryptPassword(password);
      await Prefs.updateInstance(instanceId, { passwordEncrypted: encrypted });
    } else {
      await Prefs.updateInstance(instanceId, { passwordEncrypted: '' });
    }
  },

  async loadPassword(instanceId: string): Promise<string> {
    const instance = _cache.instances.find((i) => i.id === instanceId);
    if (!instance?.savePassword || !instance.passwordEncrypted) return '';
    return decryptPassword(instance.passwordEncrypted);
  },

  async saveFilterPreset(preset: FilterPreset): Promise<void> {
    const idx = _cache.filterPresets.findIndex((p) => p.id === preset.id);
    if (idx >= 0) {
      _cache.filterPresets = _cache.filterPresets.map((p) => (p.id === preset.id ? preset : p));
    } else {
      _cache.filterPresets = [..._cache.filterPresets, preset];
    }
    await Prefs.save();
  },

  async deleteFilterPreset(presetId: string): Promise<void> {
    _cache.filterPresets = _cache.filterPresets.filter((p) => p.id !== presetId);
    await Prefs.save();
  },

  async toggleFavoriteHost(hostKey: string): Promise<boolean> {
    const set = new Set(_cache.favoriteHostIds);
    if (set.has(hostKey)) {
      set.delete(hostKey);
    } else {
      set.add(hostKey);
    }
    _cache.favoriteHostIds = [...set];
    await Prefs.save();
    return set.has(hostKey);
  },
};

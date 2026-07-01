// ============================================================
// background/worker.ts — MV3 service worker / background script
// ============================================================

import { Logger } from '../modules/service/Logger';
import { SuperController } from '../modules/controller/SuperController';
import { ServiceEventType, BackgroundMessage, BackgroundFuncName } from '../types';
import { Constants } from '../modules/constant/constants';
import { playSound, initAudio, isChrome } from './audio';
import { BrowserService, extensionAssetUrl } from '../modules/service/BrowserService';
import { assertRpcAllowed, isOptionsPageSender } from './rpcSecurity';
import { clampSoundVolume, isSoundType } from '../modules/service/Sounds';
import type { AppPrefs } from '../types';

const log = new Logger('Worker');

let keepAliveTimer: ReturnType<typeof setTimeout> | undefined;

async function keepAlive(): Promise<void> {
  if (!isChrome()) return;
  await initAudio();
}

async function initKeepAlive(): Promise<void> {
  if (!isChrome()) return;
  chrome.alarms.create({ periodInMinutes: Constants.SERVICE.KEEP_ALIVE_ALARM_PERIOD });
  chrome.alarms.onAlarm.addListener(keepAlive);
}

function refreshBadge(): void {
  void (async () => {
    const total = await SuperController.getVisibleProblemCount();
    const hasError = SuperController.getLastErrorMessage() !== null;
    const hasConnection = SuperController.hasConnectionActivated();
    BrowserService.updateBadge(total > 0 ? `${total}` : '', hasError, hasConnection);
  })();
}

function onServiceEvent(event: ServiceEventType, data?: unknown): void {
  if (event === ServiceEventType.NEED_PLAY_SOUND) {
    const payload = data as { selected: string; volumeSound: number };
    if (!isSoundType(payload.selected)) {
      log.warn('Ignored unknown sound type', payload.selected);
      return;
    }
    playSound(payload.selected, clampSoundVolume(payload.volumeSound)).catch((e) =>
      log.error('playSound failed', e),
    );
    return;
  }

  if (event === ServiceEventType.CONNECTING || event === ServiceEventType.POLLING) {
    chrome.action.setIcon({ path: extensionAssetUrl('skin/images/icon_refresh.png') });
  } else {
    refreshBadge();
  }

  chrome.runtime
    .sendMessage({ source: 'worker', func: 'needRefresh', args: [event] })
    .catch(() => log.trace('popup/options may not be open'));
}

function redactPrefs(prefs: AppPrefs, includeSecrets: boolean): AppPrefs {
  if (includeSecrets) return prefs;
  return {
    ...prefs,
    instances: prefs.instances.map((instance) => ({
      ...instance,
      passwordEncrypted: '',
      apiTokenEncrypted: '',
    })),
  };
}

const handlers: Record<string, (...args: unknown[]) => unknown> = {
  getControllers: () => SuperController.getVisibleControllerInfos(),
  getGroupedProblems: () => SuperController.getGroupedProblemsAsync(),
  getHeatmap: () => SuperController.getHeatmap(),
  getInfrastructure: () => SuperController.getInfrastructure(),
  getKnownHostGroups: () => SuperController.getKnownHostGroups(),
  getSnoozedKeys: () => SuperController.getSnoozedKeys().then((s) => [...s]),
  snoozeProblem: async (instanceId: unknown, eventid: unknown, durationSec: unknown) => {
    await SuperController.snoozeProblem(instanceId as string, eventid as string, durationSec as number);
    refreshBadge();
    return true;
  },
  unsnoozeProblem: async (instanceId: unknown, eventid: unknown) => {
    await SuperController.unsnoozeProblem(instanceId as string, eventid as string);
    refreshBadge();
    return true;
  },
  openWarRoom: () => {
    SuperController.openWarRoom();
    return true;
  },
  getHostTimeline: async (instanceId: unknown, hostid: unknown) =>
    SuperController.getHostTimeline(instanceId as string, hostid as string),
  acknowledgeProblem: async (instanceId: unknown, eventid: unknown, message: unknown) =>
    SuperController.acknowledgeProblem(instanceId as string, eventid as string, message as string),
  openZabbixHost: (instanceId: unknown, hostid: unknown) => {
    SuperController.findControllerByInstanceId(instanceId as string)?.openZabbixHost(hostid as string);
    return true;
  },
  openZabbixProblem: (instanceId: unknown, eventid: unknown) => {
    SuperController.findControllerByInstanceId(instanceId as string)?.openZabbixProblem(eventid as string);
    return true;
  },
  initializeConnection: (id: unknown, secret: unknown) => {
    const ctrl = SuperController.getControllers().find((c) => c.id === id);
    ctrl?.initializeConnection(secret as string | undefined);
    return !!ctrl;
  },
  closeConnection: (id: unknown) => {
    const ctrl = SuperController.getControllers().find((c) => c.id === id);
    ctrl?.closeConnection();
    return !!ctrl;
  },
  checkNow: (id: unknown) => {
    const ctrl = SuperController.getControllers().find((c) => c.id === id);
    ctrl?.checkNow();
    return !!ctrl;
  },
  removeController: async (id: unknown) => {
    const ctrl = SuperController.getControllers().find((c) => c.id === id);
    if (ctrl) await SuperController.removeController(ctrl);
    return !!ctrl;
  },
  addNewInstance: async () => SuperController.addNewInstance(),
  testConnection: async (
    apiUrl: unknown,
    authMethod: unknown,
    username: unknown,
    secret: unknown,
  ) =>
    SuperController.testConnection(
      apiUrl as string,
      authMethod as import('../types').ZabbixAuthMethod,
      username as string,
      secret as string,
    ),
  getPrefs: async () => {
    const { Prefs } = await import('../modules/service/Prefs');
    if (!Prefs.isLoaded()) await Prefs.load();
    return redactPrefs(Prefs.get() as AppPrefs, false);
  },
  savePassword: async (instanceId: unknown, password: unknown) => {
    const { Prefs } = await import('../modules/service/Prefs');
    await Prefs.savePassword(instanceId as string, password as string);
    return true;
  },
  saveApiToken: async (instanceId: unknown, apiToken: unknown) => {
    const { Prefs } = await import('../modules/service/Prefs');
    await Prefs.saveApiToken(instanceId as string, apiToken as string);
    return true;
  },
  updateInstance: async (instanceId: unknown, patch: unknown) => {
    const { Prefs } = await import('../modules/service/Prefs');
    await Prefs.updateInstance(instanceId as string, patch as Partial<import('../types').ZabbixInstanceConfig>);
    return true;
  },
  updatePref: async (key: unknown, value: unknown) => {
    const { Prefs } = await import('../modules/service/Prefs');
    await Prefs.update(key as keyof import('../types').AppPrefs, value as never);
    return true;
  },
  saveFilterPreset: async (preset: unknown) => {
    await SuperController.saveFilterPreset(preset as import('../types').FilterPreset);
    return true;
  },
  deleteFilterPreset: async (presetId: unknown) => {
    await SuperController.deleteFilterPreset(presetId as string);
    return true;
  },
  toggleFavoriteHost: async (hostKey: unknown) =>
    SuperController.toggleFavoriteHost(hostKey as string),
};

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender, sendResponse) => {
  if (!msg?.func) return false;

  if (msg.func === 'needKeepAlive') {
    if (sender?.id !== chrome.runtime.id) return false;
    clearTimeout(keepAliveTimer);
    keepAliveTimer = setTimeout(keepAlive, 5000);
    return false;
  }

  if (msg.source !== 'ui') return false;

  const func = msg.func as BackgroundFuncName;
  const fn = handlers[func];
  if (!fn) {
    log.warn(`Unknown message function: ${msg.func}`);
    return false;
  }

  try {
    assertRpcAllowed(func, sender);
  } catch (e) {
    log.error('RPC rejected', e);
    sendResponse(null);
    return false;
  }

  if (func === 'getPrefs' && isOptionsPageSender(sender)) {
    Promise.resolve(
      (async () => {
        const { Prefs } = await import('../modules/service/Prefs');
        if (!Prefs.isLoaded()) await Prefs.load();
        return redactPrefs(Prefs.get() as AppPrefs, true);
      })(),
    )
      .then(sendResponse)
      .catch((e) => {
        log.error('Handler error', e);
        sendResponse(null);
      });
    return true;
  }

  Promise.resolve(fn(...(msg.args ?? [])))
    .then(sendResponse)
    .catch((e) => {
      log.error('Handler error', e);
      sendResponse(null);
    });
  return true;
});

async function boot(): Promise<void> {
  try {
    log.info('Background script starting');
    SuperController.addGlobalCallback(onServiceEvent);
    await SuperController.initialize();
    await initKeepAlive();
    await initAudio();
    refreshBadge();
    log.info('Background script ready');
  } catch (e) {
    log.error('FATAL in boot', e);
  }
}

boot();

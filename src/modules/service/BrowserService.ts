// ============================================================
// modules/service/BrowserService.ts
// ============================================================

import { Logger } from './Logger';
import { Prefs } from './Prefs';

const log = new Logger('BrowserService');

const DEFAULT_NOTIFICATION_ICON = 'skin/images/zabbix_hub_48.png';

/** Resolve a path relative to the extension root (required from MV3 service workers). */
export function extensionAssetUrl(path: string): string {
  if (path.startsWith('chrome-extension://') || path.startsWith('data:') || path.startsWith('blob:')) {
    return path;
  }
  const normalized = path.replace(/^\.\/+/, '').replace(/^\//, '');
  return chrome.runtime.getURL(normalized);
}

function toExtensionUrl(path: string): string {
  return extensionAssetUrl(path);
}

function serializeError(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function tabMatchesWebInterface(tabUrl: string | undefined, targetUrl: string): boolean {
  if (!tabUrl) return false;
  try {
    return new URL(tabUrl).origin === new URL(targetUrl).origin;
  } catch {
    return false;
  }
}

export const BrowserService = {
  async notify(title: string, body: string, duration?: number, iconUrl?: string): Promise<void> {
    const safeTitle = title?.trim() || 'Zabbix Supervision Hub';
    const safeBody = body?.trim() || ' ';
    const resolvedIcon = toExtensionUrl(iconUrl ?? DEFAULT_NOTIFICATION_ICON);

    try {
      const id = `zsh-${Date.now()}`;
      await chrome.notifications.create(id, {
        type: 'basic',
        iconUrl: resolvedIcon,
        title: safeTitle,
        message: safeBody,
      });
      const time = duration ?? Prefs.get().problemNotificationDuration;
      if (time > 0) {
        setTimeout(() => chrome.notifications.clear(id), time * 1000);
      }
    } catch (e) {
      log.error('Failed to show notification', { error: serializeError(e), title: safeTitle });
    }
  },

  async openWebInterface(url: string): Promise<void> {
    if (!url) return;
    try {
      const tabs = await chrome.tabs.query({});
      const existing = tabs.find((tab) => tabMatchesWebInterface(tab.url, url));

      if (existing?.id !== undefined) {
        await chrome.tabs.update(existing.id, { active: true });
        return;
      }

      await chrome.tabs.create({ url });
    } catch (e) {
      log.error('Failed to open tab', e);
    }
  },

  openWarRoom(): void {
    const url = chrome.runtime.getURL('src/warroom/index.html');
    chrome.tabs.create({ url }).catch((e) => log.error('Failed to open war room', e));
  },

  async updateBadge(text: string, hasError: boolean, hasConnection: boolean): Promise<void> {
    try {
      let icon = extensionAssetUrl('skin/images/icon_disabled.png');
      if (hasConnection) {
        icon = hasError
          ? extensionAssetUrl('skin/images/icon_warning.png')
          : extensionAssetUrl('skin/images/icon_default.png');
      }
      await chrome.action.setIcon({ path: icon });
      await chrome.action.setBadgeText({ text });
      await chrome.action.setBadgeBackgroundColor({ color: hasError ? '#e45959' : '#e97659' });
    } catch (e) {
      log.warn('Failed to update badge', e);
    }
  },
};

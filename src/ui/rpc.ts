import type { BackgroundFuncName, BackgroundMessage } from '../types';

export function sendBackground<T = unknown>(
  func: BackgroundFuncName | 'needRefresh',
  ...args: unknown[]
): Promise<T> {
  const msg: BackgroundMessage = { source: 'ui', func: func as BackgroundFuncName, args };
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response as T);
    });
  });
}

export function i18n(key: string, ...subs: string[]): string {
  try {
    return chrome.i18n.getMessage(key, subs) || key;
  } catch {
    return key;
  }
}

export function onBackgroundRefresh(callback: (event?: string) => void): () => void {
  const listener = (msg: BackgroundMessage, sender: chrome.runtime.MessageSender) => {
    if (sender?.id !== chrome.runtime.id) return;
    if (msg?.source === 'worker' && msg.func === 'needRefresh') {
      callback(msg.args?.[0] as string | undefined);
    }
  };
  chrome.runtime.onMessage.addListener(listener);
  return () => chrome.runtime.onMessage.removeListener(listener);
}

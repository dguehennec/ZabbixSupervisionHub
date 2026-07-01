// ============================================================
// background/rpcSecurity.ts — Extension RPC sender validation
// ============================================================

import type { BackgroundFuncName } from '../types';

const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;

const OPTIONS_ONLY: ReadonlySet<BackgroundFuncName> = new Set([
  'savePassword',
  'saveApiToken',
  'updateInstance',
  'testConnection',
  'addNewInstance',
  'removeController',
  'initializeConnection',
  'closeConnection',
]);

export function isTrustedExtensionSender(sender: chrome.runtime.MessageSender | undefined): boolean {
  return (
    sender?.id === chrome.runtime.id &&
    typeof sender.url === 'string' &&
    sender.url.startsWith(extensionOrigin)
  );
}

export function isOptionsPageSender(sender: chrome.runtime.MessageSender | undefined): boolean {
  return isTrustedExtensionSender(sender) && !!sender?.url?.includes('/src/options/');
}

export function assertRpcAllowed(
  func: BackgroundFuncName,
  sender: chrome.runtime.MessageSender | undefined,
): void {
  if (!isTrustedExtensionSender(sender)) {
    throw new Error('Unauthorized sender');
  }
  if (OPTIONS_ONLY.has(func) && !isOptionsPageSender(sender)) {
    throw new Error(`Handler restricted to options page: ${func}`);
  }
}

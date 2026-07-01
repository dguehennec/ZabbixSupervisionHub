import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
import { vi } from 'vitest';

Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  configurable: true,
  writable: true,
});

if (!globalThis.TextEncoder) {
  Object.defineProperty(globalThis, 'TextEncoder', { value: TextEncoder, configurable: true });
}

if (!globalThis.TextDecoder) {
  Object.defineProperty(globalThis, 'TextDecoder', { value: TextDecoder, configurable: true });
}

export const TEST_EXTENSION_ID = 'test-extension-id-for-crypto';

export interface MockStorageArea {
  _data: Record<string, unknown>;
  _reset: () => void;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  clear: ReturnType<typeof vi.fn>;
}

function createStorageArea(): MockStorageArea {
  const data: Record<string, unknown> = {};

  return {
    _data: data,
    _reset: () => {
      for (const key of Object.keys(data)) delete data[key];
    },
    get: vi.fn(async (keys?: string | string[] | Record<string, unknown> | null) => {
      if (keys == null) return { ...data };
      const keyList = Array.isArray(keys)
        ? keys
        : typeof keys === 'string'
          ? [keys]
          : Object.keys(keys);
      const result: Record<string, unknown> = {};
      for (const key of keyList) {
        if (key in data) result[key] = data[key];
      }
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      Object.assign(data, items);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) {
        delete data[key];
      }
    }),
    clear: vi.fn(async () => {
      for (const key of Object.keys(data)) delete data[key];
    }),
  };
}

export const mockSyncStorage = createStorageArea();
export const mockLocalStorage = createStorageArea();

const mockGetMessage = vi.fn((key: string) => key);
export const mockNotificationsCreate = vi.fn().mockResolvedValue(undefined);
export const mockRequestPermission = vi.fn().mockResolvedValue(true);
export const mockContainsPermission = vi.fn().mockResolvedValue(true);
export const mockSendMessage = vi.fn((_msg: unknown, cb?: (response: unknown) => void) => {
  cb?.(null);
});

export function resetChromeMocks(): void {
  mockSyncStorage._reset();
  mockLocalStorage._reset();
  mockGetMessage.mockImplementation((key: string) => key);
  mockNotificationsCreate.mockResolvedValue(undefined);
  mockRequestPermission.mockResolvedValue(true);
  mockContainsPermission.mockResolvedValue(true);
  mockSendMessage.mockImplementation((_msg: unknown, cb?: (response: unknown) => void) => {
    cb?.(null);
  });
  chrome.runtime.id = TEST_EXTENSION_ID;
}

Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  writable: true,
  value: {
    runtime: {
      id: TEST_EXTENSION_ID,
      sendMessage: mockSendMessage,
      lastError: null,
      getURL: vi.fn((path: string) => `chrome-extension://test/${path.replace(/^\//, '')}`),
      openOptionsPage: vi.fn(),
    },
    storage: {
      sync: mockSyncStorage,
      local: mockLocalStorage,
    },
    i18n: {
      getMessage: mockGetMessage,
    },
    notifications: {
      create: mockNotificationsCreate,
      clear: vi.fn().mockResolvedValue(undefined),
    },
    permissions: {
      request: mockRequestPermission,
      contains: mockContainsPermission,
    },
    action: {
      setIcon: vi.fn(),
      setBadgeText: vi.fn(),
      setBadgeBackgroundColor: vi.fn(),
    },
    tabs: {
      create: vi.fn(),
      query: vi.fn().mockResolvedValue([]),
      update: vi.fn(),
    },
    alarms: {
      create: vi.fn(),
      onAlarm: { addListener: vi.fn() },
    },
    offscreen: {
      hasDocument: vi.fn().mockResolvedValue(false),
      createDocument: vi.fn().mockResolvedValue(undefined),
      Reason: { AUDIO_PLAYBACK: 'AUDIO_PLAYBACK' },
    },
  },
});

resetChromeMocks();

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { resetChromeMocks, TEST_EXTENSION_ID } from './setup';
import { encryptPassword, decryptPassword, resetCryptoKeyCache } from '../src/modules/service/Crypto';

describe('Crypto', () => {
  beforeEach(() => {
    resetChromeMocks();
    resetCryptoKeyCache();
    chrome.runtime.id = TEST_EXTENSION_ID;
  });

  it('encrypts and decrypts a password round-trip', async () => {
    const plain = 's3cret-zabbix-password';
    const cipher = await encryptPassword(plain);
    expect(cipher).not.toBe(plain);
    expect(await decryptPassword(cipher)).toBe(plain);
  });

  it('returns empty string for empty ciphertext', async () => {
    expect(await decryptPassword('')).toBe('');
  });

  it('returns empty string for invalid ciphertext', async () => {
    expect(await decryptPassword('not-valid-base64!!!')).toBe('');
  });
});

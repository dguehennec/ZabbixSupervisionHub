// ============================================================
// modules/service/Crypto.ts — AES-GCM credential encryption
// ============================================================

import { randomHex } from './Util';

const ALGO = 'AES-GCM';
const KEY_LEN = 256;
const IV_LEN = 12;
const SALT = 'ZabbixSupervisionHub';
const HKDF_INFO = 'password-v2';
const LEGACY_HKDF_INFO = 'password-v1';
const INSTALL_SECRET_KEY = 'zsh_install_secret';

let _cachedKey: CryptoKey | null = null;
let _cachedKeyMaterial: string | null = null;

async function readInstallSecret(): Promise<string> {
  const stored = await chrome.storage.local.get(INSTALL_SECRET_KEY);
  let secret = stored[INSTALL_SECRET_KEY] as string | undefined;
  if (!secret) {
    secret = randomHex(32);
    await chrome.storage.local.set({ [INSTALL_SECRET_KEY]: secret });
  }
  return secret;
}

async function deriveKey(material: string, info: string): Promise<CryptoKey> {
  const ikm = new TextEncoder().encode(material);
  const baseKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveKey']);

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new TextEncoder().encode(SALT),
      info: new TextEncoder().encode(info),
    },
    baseKey,
    { name: ALGO, length: KEY_LEN },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function getDerivedKey(): Promise<CryptoKey> {
  const material = await readInstallSecret();
  if (_cachedKey && _cachedKeyMaterial === material) return _cachedKey;

  _cachedKeyMaterial = material;
  _cachedKey = await deriveKey(material, HKDF_INFO);
  return _cachedKey;
}

async function getLegacyDerivedKey(): Promise<CryptoKey> {
  return deriveKey(chrome.runtime.id, LEGACY_HKDF_INFO);
}

/** @internal Clears the cached key (for unit tests). */
export function resetCryptoKeyCache(): void {
  _cachedKey = null;
  _cachedKeyMaterial = null;
}

async function decryptWithKey(ciphertext: string, key: CryptoKey): Promise<string> {
  const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, IV_LEN);
  const data = combined.slice(IV_LEN);
  const plain = await crypto.subtle.decrypt({ name: ALGO, iv }, key, data);
  return new TextDecoder().decode(plain);
}

export async function encryptPassword(plaintext: string): Promise<string> {
  const key = await getDerivedKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
  const encoded = new TextEncoder().encode(plaintext);

  const cipher = await crypto.subtle.encrypt({ name: ALGO, iv }, key, encoded);

  const combined = new Uint8Array(IV_LEN + cipher.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(cipher), IV_LEN);

  return btoa(String.fromCharCode(...combined));
}

export async function decryptPassword(ciphertext: string): Promise<string> {
  try {
    if (!ciphertext) return '';
    const key = await getDerivedKey();
    return await decryptWithKey(ciphertext, key);
  } catch {
    try {
      const legacyKey = await getLegacyDerivedKey();
      return await decryptWithKey(ciphertext, legacyKey);
    } catch {
      return '';
    }
  }
}

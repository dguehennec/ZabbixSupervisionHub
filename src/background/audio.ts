// ============================================================
// background/audio.ts
// ============================================================

import { SoundType } from '../types';
import { resolveSoundUrl, clampSoundVolume } from '../modules/service/Sounds';
import { Logger } from '../modules/service/Logger';

const log = new Logger('Audio');

async function ensureOffscreenDocument(): Promise<void> {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'src/offscreen/offscreen.html',
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: 'Needed to play Zabbix problem notification sounds',
  });
}

async function playSoundViaOffscreen(selected: SoundType, volume: number): Promise<void> {
  await ensureOffscreenDocument();
  await new Promise((r) => setTimeout(r, 200));
  chrome.runtime
    .sendMessage({
      source: 'worker',
      func: 'playSound',
      args: [selected, volume],
    })
    .catch(() => log.trace('offscreen may not be ready yet'));
}

async function playSoundViaWebAudio(selected: SoundType, volume: number): Promise<void> {
  try {
    const url = resolveSoundUrl(selected);
    const response = await fetch(url);
    const arrayBuffer = await response.arrayBuffer();
    const ctx = new AudioContext();
    const buffer = await ctx.decodeAudioData(arrayBuffer);
    const source = ctx.createBufferSource();
    const gainNode = ctx.createGain();
    gainNode.gain.value = clampSoundVolume(volume) / 100;
    source.buffer = buffer;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);
    source.start(0);
    source.addEventListener('ended', () => ctx.close().catch(() => undefined));
  } catch (e) {
    log.error('playSoundViaWebAudio failed', e);
  }
}

export function isChrome(): boolean {
  return typeof chrome !== 'undefined' && typeof chrome.offscreen !== 'undefined';
}

export async function playSound(selected: SoundType, volume: number): Promise<void> {
  const safeVolume = clampSoundVolume(volume);
  if (isChrome()) {
    await playSoundViaOffscreen(selected, safeVolume);
  } else {
    await playSoundViaWebAudio(selected, safeVolume);
  }
}

export async function initAudio(): Promise<void> {
  if (isChrome()) {
    await ensureOffscreenDocument();
  }
}

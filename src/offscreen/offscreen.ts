// ============================================================
// offscreen/offscreen.ts — Audio playback in offscreen document
// ============================================================

import { SoundType, BackgroundMessage } from '../types';
import { resolveSoundUrl, clampSoundVolume, isSoundType } from '../modules/service/Sounds';
import { Logger } from '../modules/service/Logger';

const log = new Logger('Offscreen');

let audio: HTMLAudioElement | null = null;

function playSound(selected: SoundType, volume: number): void {
  try {
    const src = resolveSoundUrl(selected);

    if (audio) {
      audio.pause();
      audio = null;
    }
    audio = new Audio(src);
    audio.volume = clampSoundVolume(volume) / 100;
    audio.play().catch((e) => log.error('play failed', e));
  } catch (e) {
    log.error('playSound error', e);
  }
}

setInterval(() => {
  chrome.runtime
    .sendMessage({ source: 'offscreen', func: 'needKeepAlive', args: [] })
    .catch(() => log.trace('sw may restart'));
}, 20000);

chrome.runtime.onMessage.addListener((msg: BackgroundMessage, sender) => {
  if (sender?.id !== chrome.runtime.id) {
    log.error('Sender not authorized');
    return;
  }
  if (msg?.func !== 'playSound') return;
  const selected = msg.args?.[0];
  const volume = msg.args?.[1];
  if (!isSoundType(selected) || typeof volume !== 'number') {
    log.warn('Invalid playSound payload');
    return;
  }
  playSound(selected, volume);
});

// ============================================================
// modules/service/Sounds.ts — Severity alarm paths & resolution
// ============================================================

import { SoundType, ZabbixSeverity } from '../../types';

const SOUND_PATHS: Record<SoundType, string> = {
  [SoundType.NONE]: 'skin/audio/no_sound.mp3',
  [SoundType.ALARM_OK]: 'skin/audio/alarm_ok.mp3',
  [SoundType.ALARM_INFORMATION]: 'skin/audio/alarm_information.mp3',
  [SoundType.ALARM_WARNING]: 'skin/audio/alarm_warning.mp3',
  [SoundType.ALARM_AVERAGE]: 'skin/audio/alarm_average.mp3',
  [SoundType.ALARM_HIGH]: 'skin/audio/alarm_high.mp3',
  [SoundType.ALARM_DISASTER]: 'skin/audio/alarm_disaster.mp3',
};


export const DEFAULT_SEVERITY_SOUND_MAP: Record<ZabbixSeverity, SoundType> = {
  [ZabbixSeverity.NOT_CLASSIFIED]: SoundType.ALARM_OK,
  [ZabbixSeverity.INFORMATION]: SoundType.ALARM_INFORMATION,
  [ZabbixSeverity.WARNING]: SoundType.ALARM_WARNING,
  [ZabbixSeverity.AVERAGE]: SoundType.ALARM_AVERAGE,
  [ZabbixSeverity.HIGH]: SoundType.ALARM_HIGH,
  [ZabbixSeverity.DISASTER]: SoundType.ALARM_DISASTER,
};

export function defaultSoundForSeverity(severity: ZabbixSeverity): SoundType {
  return DEFAULT_SEVERITY_SOUND_MAP[severity] ?? SoundType.ALARM_AVERAGE;
}


export function resolveSoundUrl(selected: SoundType): string {
  const path = SOUND_PATHS[selected] ?? SOUND_PATHS[SoundType.ALARM_AVERAGE];
  return chrome.runtime.getURL(path);
}

export function clampSoundVolume(volume: number): number {
  return Math.max(0, Math.min(100, Math.round(volume)));
}

export function isSoundType(value: unknown): value is SoundType {
  return typeof value === 'string' && Object.values(SoundType).includes(value as SoundType);
}

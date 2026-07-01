import { describe, it, expect } from 'vitest';
import { SoundType, ZabbixSeverity } from '../src/types';
import {
  defaultSoundForSeverity,
} from '../src/modules/service/Sounds';

describe('Sounds', () => {
  it('maps each severity to its alarm file by default', () => {
    expect(defaultSoundForSeverity(ZabbixSeverity.DISASTER)).toBe(SoundType.ALARM_DISASTER);
    expect(defaultSoundForSeverity(ZabbixSeverity.HIGH)).toBe(SoundType.ALARM_HIGH);
    expect(defaultSoundForSeverity(ZabbixSeverity.AVERAGE)).toBe(SoundType.ALARM_AVERAGE);
    expect(defaultSoundForSeverity(ZabbixSeverity.WARNING)).toBe(SoundType.ALARM_WARNING);
    expect(defaultSoundForSeverity(ZabbixSeverity.INFORMATION)).toBe(SoundType.ALARM_INFORMATION);
    expect(defaultSoundForSeverity(ZabbixSeverity.NOT_CLASSIFIED)).toBe(SoundType.ALARM_OK);
  });
});

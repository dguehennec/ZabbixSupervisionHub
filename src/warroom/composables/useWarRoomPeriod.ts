import { computed, ref } from 'vue';
import {
  DEFAULT_WARROOM_PERIOD_SEC,
  fromDatetimeLocalValue,
  toDatetimeLocalValue,
} from '../utils/warRoomStats';

export function useWarRoomPeriod(defaultDurationSec = DEFAULT_WARROOM_PERIOD_SEC) {
  const slidingWindow = ref(true);
  const periodDurationSec = ref(defaultDurationSec);
  const fixedStartSec = ref(Math.floor(Date.now() / 1000) - defaultDurationSec);
  const fixedEndSec = ref(Math.floor(Date.now() / 1000));
  const nowTick = ref(Date.now());

  function touchNow(): void {
    nowTick.value = Date.now();
  }

  const timeEndSec = computed(() => {
    void nowTick.value;
    if (slidingWindow.value) return Math.floor(Date.now() / 1000);
    return fixedEndSec.value;
  });

  const timeStartSec = computed(() => {
    void nowTick.value;
    if (slidingWindow.value) return timeEndSec.value - periodDurationSec.value;
    return fixedStartSec.value;
  });

  const startInput = computed({
    get: () => toDatetimeLocalValue(timeStartSec.value),
    set: (value: string) => {
      if (!value) return;
      slidingWindow.value = false;
      fixedStartSec.value = fromDatetimeLocalValue(value);
      if (fixedStartSec.value >= fixedEndSec.value) {
        fixedEndSec.value = fixedStartSec.value + periodDurationSec.value;
      }
    },
  });

  const endInput = computed({
    get: () => toDatetimeLocalValue(timeEndSec.value),
    set: (value: string) => {
      if (!value) return;
      slidingWindow.value = false;
      fixedEndSec.value = fromDatetimeLocalValue(value);
      if (fixedEndSec.value <= fixedStartSec.value) {
        fixedStartSec.value = fixedEndSec.value - periodDurationSec.value;
      }
    },
  });

  function useLastHours(hours: number): void {
    periodDurationSec.value = hours * 3600;
    slidingWindow.value = true;
    touchNow();
  }

  function onAutoRefresh(): void {
    touchNow();
  }

  return {
    slidingWindow,
    timeStartSec,
    timeEndSec,
    startInput,
    endInput,
    useLastHours,
    onAutoRefresh,
  };
}

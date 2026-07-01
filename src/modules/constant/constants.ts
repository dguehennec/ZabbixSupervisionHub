// ============================================================
// modules/constant/constants.ts
// ============================================================

import { LogLevel, ZabbixSeverity } from '../../types';
import { DEFAULT_SEVERITY_SOUND_MAP } from '../service/Sounds';

export const Constants = {
  VERSION: 1,

  DONATE_URL: 'https://www.paypal.me/DavidGUEHENNEC/5',

  BUILTIN_ENVIRONMENT_IDS: {
    OTHER: 'other',
    HIDE: 'hide',
  },

  DEFAULT_ENVIRONMENTS: [
    { id: 'other', label: 'Autre', builtin: true, hidden: false },
    { id: 'hide', label: 'Cacher', builtin: true, hidden: true },
  ] as const,

  LOGGER: {
    LEVEL: LogLevel.INFO,
    PRINT_STACK: true,
    PRINT_DATA_REQUEST: false,
  },

  SERVICE: {
    POLL_INTERVAL_MS: 60_000,
    CONNECT_BASE_WAIT_AFTER_FAILURE: 30_000,
    CONNECT_MAX_WAIT_AFTER_FAILURE: 15 * 60_000,
    KEEP_ALIVE_ALARM_PERIOD: 1,
    MAX_PROBLEM_NOTIFIERS: 100,
  },

  RETRY: {
    MAX_ATTEMPTS: 4,
    BASE_DELAY_MS: 1_000,
    MAX_DELAY_MS: 30_000,
    BACKOFF_FACTOR: 2,
    JITTER_MS: 500,
  },

  DEFAULT_PREFS: {
    AUTO_CONNECT: false,
    POLL_INTERVAL_MS: 60_000,
    PROBLEM_NOTIFICATION_ENABLED: true,
    PROBLEM_SOUND_ENABLED: true,
    PROBLEM_SOUND_VOLUME: 80,
    PROBLEM_NOTIFICATION_DURATION: 8,
    MIN_SEVERITY_NOTIFY: ZabbixSeverity.AVERAGE,
    MIN_SEVERITY_DISPLAY: ZabbixSeverity.NOT_CLASSIFIED,
    WAR_ROOM_REFRESH_SEC: 15,
    HIDE_SNOOZED_PROBLEMS: true,
    HIDE_ACKNOWLEDGED_PROBLEMS: false,
    EXCLUDE_DISABLED_HOSTS: true,
    EXCLUDE_MAINTENANCE_HOSTS: false,
    EXCLUDE_DISABLED_TRIGGERS: true,
    SEVERITY_SOUND_MAP: DEFAULT_SEVERITY_SOUND_MAP,
  },

  ZABBIX: {
    API_PATH: '/api_jsonrpc.php',
    PROBLEM_OUTPUT: ['eventid', 'name', 'severity', 'clock', 'acknowledged', 'objectid'],
    HOST_OUTPUT: ['hostid', 'name', 'status'],
    EVENT_OUTPUT: ['eventid', 'name', 'severity', 'clock', 'acknowledged', 'value'],
  },
} as const;

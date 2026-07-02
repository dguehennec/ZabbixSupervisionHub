// ============================================================
// types/index.ts — Shared types for Zabbix Supervision Hub
// ============================================================

// ─── Enums ───────────────────────────────────────────────────

export enum RequestStatus {
  NOT_STARTED = -2,
  RUNNING = -1,
  NO_ERROR = 0,
  INTERNAL_ERROR = 1,
  CANCELED = 2,
  TIMEOUT = 3,
  SERVER_ERROR = 4,
  NETWORK_ERROR = 5,
  AUTH_REQUIRED = 6,
  LOGIN_INVALID = 7,
  REQUEST_INVALID = 9,
  ORIGIN_PERMISSION_ERROR = 11,
}

export enum ServiceState {
  NOTHING_TO_DO = 'NOTHING_TO_DO',
  CONNECT_RUN = 'CONNECT_RUN',
  CONNECT_WAIT = 'CONNECT_WAIT',
  POLL_START = 'POLL_START',
  POLL_WAIT = 'POLL_WAIT',
}

export enum ServiceEventType {
  STOPPED = 'STOPPED',
  CONNECTING = 'CONNECTING',
  INVALID_LOGIN = 'INVALID_LOGIN',
  ORIGIN_PERMISSION_ERROR = 'ORIGIN_PERMISSION_ERROR',
  CONNECT_ERR = 'CONNECT_ERR',
  CONNECTED = 'CONNECTED',
  DISCONNECTED = 'DISCONNECTED',
  POLLING = 'POLLING',
  PROBLEMS_UPDATED = 'PROBLEMS_UPDATED',
  HOSTS_UPDATED = 'HOSTS_UPDATED',
  REQUEST_FAILED = 'REQUEST_FAILED',
  NEED_PLAY_SOUND = 'NEED_PLAY_SOUND',
}

export enum LogLevel {
  ERROR = 1,
  WARNING = 2,
  INFO = 3,
  TRACE = 4,
}

export enum ZabbixSeverity {
  NOT_CLASSIFIED = 0,
  INFORMATION = 1,
  WARNING = 2,
  AVERAGE = 3,
  HIGH = 4,
  DISASTER = 5,
}

export enum SoundType {
  NONE = 'none',
  ALARM_OK = 'alarm_ok',
  ALARM_INFORMATION = 'alarm_information',
  ALARM_WARNING = 'alarm_warning',
  ALARM_AVERAGE = 'alarm_average',
  ALARM_HIGH = 'alarm_high',
  ALARM_DISASTER = 'alarm_disaster',
}

export enum ZabbixAuthMethod {
  PASSWORD = 'password',
  API_TOKEN = 'api_token',
}

/** User-defined or built-in environment (host group target). */
export interface EnvironmentDefinition {
  id: string;
  label: string;
  /** Built-in entries (Other, Hide) cannot be removed. */
  builtin?: boolean;
  /** Hidden environments (e.g. Hide) exclude incidents from the UI. */
  hidden?: boolean;
}

// ─── Domain interfaces ────────────────────────────────────────

export interface ZabbixProblem {
  eventid: string;
  name: string;
  severity: ZabbixSeverity;
  clock: number;
  acknowledged: boolean;
  objectid: string;
  hostid: string;
  hostName: string;
  instanceId: string;
  instanceAlias: string;
  environment: string;
}

export interface ZabbixHost {
  hostid: string;
  name: string;
  status: number;
  instanceId: string;
  groupIds: string[];
  groupNames: string[];
  environment: string;
}

export interface ZabbixEvent {
  eventid: string;
  name: string;
  severity: ZabbixSeverity;
  clock: number;
  acknowledged: boolean;
  value: number;
}

export interface ProblemGroup {
  key: string;
  name: string;
  severity: ZabbixSeverity;
  problems: ZabbixProblem[];
  hostCount: number;
  instanceIds: string[];
}

export interface HeatmapCell {
  hostid: string;
  hostName: string;
  instanceId: string;
  instanceAlias: string;
  counts: Record<ZabbixSeverity, number>;
  maxSeverity: ZabbixSeverity;
  total: number;
}

export interface InfraHostNode {
  hostid: string;
  name: string;
  instanceId: string;
  problemCount: number;
  maxSeverity: ZabbixSeverity;
  isFavorite: boolean;
}

export interface InfraInstanceNode {
  instanceId: string;
  alias: string;
  apiUrl: string;
  isConnected: boolean;
  hosts: InfraHostNode[];
  problemCount: number;
}

export interface InfraEnvironmentNode {
  environment: string;
  instances: InfraInstanceNode[];
  problemCount: number;
}

export interface FilterPreset {
  id: string;
  name: string;
  search?: string;
  severities?: ZabbixSeverity[];
  environment?: string;
  instanceId?: string;
  acknowledgedOnly?: boolean;
  unacknowledgedOnly?: boolean;
  groupByTrigger?: boolean;
}

export interface SnoozedProblem {
  eventKey: string;
  instanceId: string;
  eventid: string;
  snoozeUntil: number;
  createdAt: number;
}

export interface SessionInfo {
  authToken: string | null;
  apiUrl: string;
  username: string;
  version: string;
  connectionDate: Date | null;
}

export interface EnvironmentHostGroupRule {
  id: string;
  hostGroupName: string;
  environmentId: string;
}

/** Hide incidents whose title matches this JavaScript regular expression. */
export interface ProblemTitleHideRule {
  id: string;
  pattern: string;
}

export interface ZabbixInstanceConfig {
  id: string;
  alias: string;
  apiUrl: string;
  webUrl: string;
  username: string;
  passwordEncrypted: string;
  savePassword: boolean;
  authMethod: ZabbixAuthMethod;
  apiTokenEncrypted: string;
  saveApiToken: boolean;
  enabled: boolean;
}

export interface AppPrefs {
  isFirstLaunch: boolean;
  previousVersion: number;
  currentVersion: number;
  autoConnect: boolean;
  pollIntervalMs: number;
  problemNotificationEnabled: boolean;
  problemSoundEnabled: boolean;
  problemSoundVolume: number;
  problemNotificationDuration: number;
  severitySoundMap: Record<ZabbixSeverity, SoundType>;
  minSeverityDisplay: ZabbixSeverity;
  instances: ZabbixInstanceConfig[];
  filterPresets: FilterPreset[];
  favoriteHostIds: string[];
  warRoomRefreshSec: number;
  hideSnoozedProblems: boolean;
  hideAcknowledgedProblems: boolean;
  environments: EnvironmentDefinition[];
  environmentHostGroupRules: EnvironmentHostGroupRule[];
  problemTitleHideRules: ProblemTitleHideRule[];
  /** When true, host.get excludes disabled hosts (status=1). Default: true. */
  excludeDisabledHosts: boolean;
  /** When true, host.get excludes hosts in maintenance. Default: false. */
  excludeMaintenanceHosts: boolean;
  /** Exclude problems from disabled triggers/items (Zabbix UI behavior). Default: true. */
  excludeDisabledTriggers: boolean;
}

// ─── Dexie cache types ────────────────────────────────────────

export interface CachedProblem {
  eventid: string;
  instanceId: string;
  name: string;
  severity: ZabbixSeverity;
  clock: number;
  acknowledged: boolean;
  hostid: string;
  hostName: string;
  environment: string;
  updatedAt: number;
}

export interface CachedHost {
  hostid: string;
  instanceId: string;
  name: string;
  status: number;
  updatedAt: number;
}

// ─── Messaging types ─────────────────────────────────────────

export type BackgroundFuncName =
  | 'getControllers'
  | 'getGroupedProblems'
  | 'getHeatmap'
  | 'getInfrastructure'
  | 'getHostTimeline'
  | 'acknowledgeProblem'
  | 'openZabbixHost'
  | 'openZabbixProblem'
  | 'initializeConnection'
  | 'closeConnection'
  | 'checkNow'
  | 'removeController'
  | 'addNewInstance'
  | 'getPrefs'
  | 'savePassword'
  | 'saveApiToken'
  | 'updateInstance'
  | 'updatePref'
  | 'testConnection'
  | 'saveFilterPreset'
  | 'deleteFilterPreset'
  | 'toggleFavoriteHost'
  | 'snoozeProblem'
  | 'unsnoozeProblem'
  | 'getSnoozedKeys'
  | 'openWarRoom'
  | 'getKnownHostGroups';

export interface BackgroundMessage {
  source: string;
  func: BackgroundFuncName | 'log' | 'needKeepAlive' | 'needRefresh' | 'playSound';
  args: unknown[];
}

export interface ErrorEntry {
  status: RequestStatus;
  message: string;
  ts: number;
}

export interface ControllerInfo {
  id: string;
  instanceId: string;
  instanceAlias: string;
  instanceApiUrl: string;
  isConnected: boolean;
  isConnecting: boolean;
  problemCount: number;
  disasterCount: number;
  highCount: number;
  problems: ZabbixProblem[];
  lastErrorMessage: ErrorEntry | null;
  zabbixVersion: string;
}

export interface ProblemSummary {
  total: number;
  disaster: number;
  high: number;
  average: number;
  warning: number;
  information: number;
  notClassified: number;
}

// ─── Zabbix API raw types ─────────────────────────────────────

export interface ZabbixJsonRpcRequest {
  jsonrpc: '2.0';
  method: string;
  params: Record<string, unknown>;
  id: number;
  auth?: string;
}

export interface ZabbixJsonRpcResponse<T = unknown> {
  jsonrpc: '2.0';
  result?: T;
  error?: { code: number; message: string; data?: string };
  id: number;
}

export interface ZabbixProblemRaw {
  eventid: string;
  name: string;
  severity: string;
  clock: string;
  acknowledged: string;
  objectid: string;
  hosts?: Array<{ hostid: string; name: string }>;
}

export interface ZabbixHostRaw {
  hostid: string;
  name: string;
  status: string;
  maintenance_status?: string;
  hostgroups?: Array<{ groupid: string; name: string }>;
}

export interface HostFetchFilter {
  excludeDisabledHosts?: boolean;
  excludeMaintenanceHosts?: boolean;
}

export interface ProblemFetchFilter {
  /** Exclude problems whose trigger/item/host is disabled (matches Zabbix UI). Default: true. */
  excludeDisabledTriggers?: boolean;
}

export interface ZabbixTriggerRaw {
  triggerid: string;
}

export interface ZabbixEventRaw {
  eventid: string;
  name: string;
  severity: string;
  clock: string;
  acknowledged: string;
  value: string;
}

// ─── Error types ─────────────────────────────────────────────

export class ZabbixError extends Error {
  constructor(
    public readonly code: RequestStatus,
    message: string,
    public readonly zabbixCode?: number,
  ) {
    super(message);
    this.name = 'ZabbixError';
  }
}

export class NetworkError extends ZabbixError {
  constructor(message: string, public readonly retriable = true) {
    super(RequestStatus.NETWORK_ERROR, message);
    this.name = 'NetworkError';
  }
}

export class AuthError extends ZabbixError {
  constructor(message: string) {
    super(RequestStatus.AUTH_REQUIRED, message);
    this.name = 'AuthError';
  }
}

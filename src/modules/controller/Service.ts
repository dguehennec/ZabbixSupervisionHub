// ============================================================
// modules/controller/Service.ts — Zabbix polling state machine
// ============================================================

import {
  ServiceState,
  ServiceEventType,
  ZabbixProblem,
  ZabbixHost,
  ZabbixEvent,
  RequestStatus,
  SessionInfo,
  ZabbixError,
  AuthError,
  NetworkError,
  ErrorEntry,
  ZabbixSeverity,
  ZabbixInstanceConfig,
  ZabbixAuthMethod,
} from '../../types';
import { Logger } from '../service/Logger';
import { ZabbixApiClient } from '../service/ZabbixApiClient';
import { Prefs } from '../service/Prefs';
import { ProblemNotifier } from '../service/ProblemNotifier';
import { Constants } from '../constant/constants';
import { BUILTIN_ENVIRONMENT_IDS } from '../service/Environments';
import {
  i18n,
  filterNewItemsById,
  checkOriginPermission,
  requestOriginPermission,
  resolveEnvironmentFromHostGroups,
} from '../service/Util';
import { cacheProblems, cacheHosts, clearInstanceCache } from '../../db/schema';
import { SnoozeManager } from '../service/SnoozeManager';

const log = new Logger('Service');

type ConnectCredential =
  | { method: ZabbixAuthMethod.PASSWORD; password: string }
  | { method: ZabbixAuthMethod.API_TOKEN; apiToken: string };

export interface ServiceDelegate {
  readonly instanceId: string;
  onEvent(event: ServiceEventType, data?: unknown): void;
  onSessionChanged(info: SessionInfo): void;
}

export class Service {
  private state: ServiceState = ServiceState.NOTHING_TO_DO;
  private client: ZabbixApiClient | null = null;
  private stateTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  private problems: ZabbixProblem[] = [];
  private hosts: ZabbixHost[] = [];
  private pollCount = 0;
  private sessionInfo: SessionInfo = {
    authToken: null,
    apiUrl: '',
    username: '',
    version: '',
    connectionDate: null,
  };

  private errors: ErrorEntry[] = [];
  private connectRetryDelay = 0;
  private firstPoll = true;

  constructor(private readonly delegate: ServiceDelegate) {}

  getInstance(): ZabbixInstanceConfig | null {
    return Prefs.get().instances.find((i) => i.id === this.delegate.instanceId) ?? null;
  }

  isConnected(): boolean {
    return this.client?.isAuthenticated ?? false;
  }

  isConnecting(): boolean {
    return this.state === ServiceState.CONNECT_RUN;
  }

  getProblems(): ZabbixProblem[] {
    return this.problems;
  }

  getHosts(): ZabbixHost[] {
    return this.hosts;
  }

  getSessionInfo(): SessionInfo {
    return this.sessionInfo;
  }

  getLastErrorMessage(): ErrorEntry | null {
    return this.errors[this.errors.length - 1] ?? null;
  }

  async initializeConnection(manualSecret?: string): Promise<void> {
    log.info('initializeConnection', { instanceId: this.delegate.instanceId });
    this.shutdown();
    this.running = true;
    this.firstPoll = true;
    this.connectRetryDelay = 0;

    const instance = this.getInstance();
    if (!instance?.enabled) {
      this.delegate.onEvent(ServiceEventType.STOPPED);
      return;
    }

    const credential = await this.resolveConnectCredential(instance, manualSecret);
    if (!credential) {
      this.delegate.onEvent(ServiceEventType.INVALID_LOGIN);
      const authMethod = instance.authMethod ?? ZabbixAuthMethod.PASSWORD;
      this.addError(
        RequestStatus.LOGIN_INVALID,
        i18n(
          authMethod === ZabbixAuthMethod.API_TOKEN
            ? 'error_api_token_not_set'
            : 'error_password_not_set',
        ),
      );
      return;
    }

    this.planState(ServiceState.CONNECT_RUN, 0, credential);
  }

  private async resolveConnectCredential(
    instance: ZabbixInstanceConfig,
    manualSecret?: string,
  ): Promise<ConnectCredential | null> {
    const authMethod = instance.authMethod ?? ZabbixAuthMethod.PASSWORD;
    if (authMethod === ZabbixAuthMethod.API_TOKEN) {
      const apiToken = manualSecret ?? (await Prefs.loadApiToken(this.delegate.instanceId));
      return apiToken ? { method: ZabbixAuthMethod.API_TOKEN, apiToken } : null;
    }
    const password = manualSecret ?? (await Prefs.loadPassword(this.delegate.instanceId));
    return password ? { method: ZabbixAuthMethod.PASSWORD, password } : null;
  }

  checkNow(): void {
    if (!this.isConnected()) return;
    this.stopStateTimer();
    this.planState(ServiceState.POLL_START, 0);
  }

  async acknowledgeProblem(eventid: string, message: string): Promise<boolean> {
    if (!this.client?.isAuthenticated) return false;
    try {
      await this.client.acknowledgeEvents([eventid], message);
      const problem = this.problems.find((p) => p.eventid === eventid);
      if (problem) problem.acknowledged = true;
      this.delegate.onEvent(ServiceEventType.PROBLEMS_UPDATED, this.problems);
      return true;
    } catch (e) {
      log.error('Acknowledge failed', e);
      this.addError(
        e instanceof ZabbixError ? e.code : RequestStatus.INTERNAL_ERROR,
        e instanceof Error ? e.message : String(e),
      );
      return false;
    }
  }

  async getHostTimeline(hostid: string, limit = 50): Promise<ZabbixEvent[]> {
    if (!this.client?.isAuthenticated) return [];
    try {
      const raw = await this.client.getEvents(hostid, limit);
      return raw.map((e) => ({
        eventid: e.eventid,
        name: e.name,
        severity: parseInt(e.severity, 10) as ZabbixSeverity,
        clock: parseInt(e.clock, 10),
        acknowledged: e.acknowledged === '1',
        value: parseInt(e.value, 10),
      }));
    } catch (e) {
      log.error('getHostTimeline failed', e);
      return [];
    }
  }

  closeConnection(): void {
    log.info('closeConnection', { instanceId: this.delegate.instanceId });
    this.shutdown();
    this.delegate.onEvent(ServiceEventType.DISCONNECTED);
  }

  shutdown(): void {
    this.running = false;
    this.stopStateTimer();
    this.problems = [];
    this.hosts = [];
    this.pollCount = 0;
    this.errors = [];
    this.connectRetryDelay = 0;
    this.firstPoll = true;
    this.sessionInfo = {
      authToken: null,
      apiUrl: '',
      username: '',
      version: '',
      connectionDate: null,
    };

    if (this.client) {
      this.client.abort();
      this.client = null;
    }
  }

  private addError(status: RequestStatus, message: string): void {
    this.errors.push({ status, message, ts: Date.now() });
  }

  private planState(state: ServiceState, delayMs: number, ...extra: unknown[]): void {
    this.stopStateTimer();
    this.stateTimer = setTimeout(() => {
      this.stateTimer = null;
      this.runState(state, ...extra).catch((e) => {
        log.error('Unhandled state error', e);
        this.planState(ServiceState.NOTHING_TO_DO, 500);
      });
    }, delayMs);
  }

  private stopStateTimer(): void {
    if (this.stateTimer !== null) {
      clearTimeout(this.stateTimer);
      this.stateTimer = null;
    }
  }

  private async runState(state: ServiceState, ...extra: unknown[]): Promise<void> {
    if (!this.running && state !== ServiceState.NOTHING_TO_DO) return;
    this.state = state;

    switch (state) {
      case ServiceState.CONNECT_RUN:
        await this.stateConnect(extra[0] as ConnectCredential);
        break;
      case ServiceState.CONNECT_WAIT:
        this.connectRetryDelay = Math.min(
          (this.connectRetryDelay || 0) + Constants.SERVICE.CONNECT_BASE_WAIT_AFTER_FAILURE,
          Constants.SERVICE.CONNECT_MAX_WAIT_AFTER_FAILURE,
        );
        this.delegate.onEvent(ServiceEventType.CONNECT_ERR);
        {
          const instance = this.getInstance();
          const credential = instance
            ? await this.resolveConnectCredential(instance)
            : null;
          if (credential) {
            this.planState(ServiceState.CONNECT_RUN, this.connectRetryDelay, credential);
          } else {
            this.planState(ServiceState.NOTHING_TO_DO, 0);
          }
        }
        break;
      case ServiceState.POLL_START:
        await this.statePoll();
        break;
      case ServiceState.POLL_WAIT: {
        const pollInterval = Prefs.get().pollIntervalMs ?? Constants.SERVICE.POLL_INTERVAL_MS;
        this.planState(ServiceState.POLL_START, pollInterval);
        break;
      }
      case ServiceState.NOTHING_TO_DO:
        this.delegate.onEvent(ServiceEventType.STOPPED);
        break;
      default:
        break;
    }
  }

  private async stateConnect(credential: ConnectCredential): Promise<void> {
    this.delegate.onEvent(ServiceEventType.CONNECTING);
    const instance = this.getInstance();
    if (!instance) {
      this.delegate.onEvent(ServiceEventType.INVALID_LOGIN);
      this.addError(RequestStatus.LOGIN_INVALID, i18n('error_instance_not_found'));
      this.planState(ServiceState.NOTHING_TO_DO, 0);
      return;
    }

    const hasPermission = await checkOriginPermission(instance.apiUrl);
    if (!hasPermission) {
      this.delegate.onEvent(ServiceEventType.ORIGIN_PERMISSION_ERROR);
      this.addError(RequestStatus.ORIGIN_PERMISSION_ERROR, i18n('error_origin_permission'));
      this.planState(ServiceState.NOTHING_TO_DO, 0);
      return;
    }

    try {
      this.client = new ZabbixApiClient(instance.apiUrl);
      const version = await this.client.getVersion();
      let token: string;
      if (credential.method === ZabbixAuthMethod.API_TOKEN) {
        token = await this.client.authenticateWithApiToken(credential.apiToken);
      } else {
        if (!instance.username?.trim()) {
          throw new AuthError(i18n('error_username_not_set'));
        }
        token = await this.client.login(instance.username, credential.password);
      }

      this.sessionInfo = {
        authToken: token,
        apiUrl: instance.apiUrl,
        username:
          instance.username?.trim() ||
          (credential.method === ZabbixAuthMethod.API_TOKEN ? 'API token' : ''),
        version,
        connectionDate: new Date(),
      };
      this.delegate.onSessionChanged(this.sessionInfo);
      this.delegate.onEvent(ServiceEventType.CONNECTED);
      this.planState(ServiceState.POLL_START, 0);
    } catch (e) {
      log.error('Connect failed', e);
      if (e instanceof AuthError) {
        this.delegate.onEvent(ServiceEventType.INVALID_LOGIN);
        this.addError(RequestStatus.LOGIN_INVALID, e.message);
        this.planState(ServiceState.NOTHING_TO_DO, 0);
      } else if (e instanceof NetworkError) {
        this.planState(ServiceState.CONNECT_WAIT, 0);
        this.addError(RequestStatus.NETWORK_ERROR, e.message);
      } else if (e instanceof ZabbixError) {
        this.planState(ServiceState.CONNECT_WAIT, 0);
        this.addError(e.code, e.message);
      } else {
        this.planState(ServiceState.CONNECT_WAIT, 0);
        this.addError(RequestStatus.INTERNAL_ERROR, String(e));
      }
    }
  }

  private async statePoll(): Promise<void> {
    if (!this.client || !this.running) return;
    const instance = this.getInstance();
    if (!instance) return;

    this.delegate.onEvent(ServiceEventType.POLLING);

    try {
      const prefs = Prefs.get();
      const hostFilter = {
        excludeDisabledHosts: prefs.excludeDisabledHosts ?? true,
        excludeMaintenanceHosts: prefs.excludeMaintenanceHosts ?? false,
      };
      const problemFilter = {
        excludeDisabledTriggers: prefs.excludeDisabledTriggers ?? true,
      };
      const [rawProblems, rawHosts] = await Promise.all([
        this.client.getProblems(problemFilter),
        this.client.getHosts(hostFilter),
      ]);
      this.pollCount++;

      const hostMap = new Map(rawHosts.map((h) => [h.hostid, h.name]));
      const envRules = Prefs.get().environmentHostGroupRules ?? [];

      const mappedHosts: ZabbixHost[] = rawHosts.map((h) => {
        const groupNames = (h.hostgroups ?? []).map((g) => g.name);
        return {
          hostid: h.hostid,
          name: h.name,
          status: parseInt(h.status, 10),
          instanceId: instance.id,
          groupIds: (h.hostgroups ?? []).map((g) => g.groupid),
          groupNames,
          environment: resolveEnvironmentFromHostGroups(groupNames, envRules),
        };
      });

      const hostEnvById = new Map(mappedHosts.map((h) => [h.hostid, h.environment]));
      const knownHostIds = new Set(mappedHosts.map((h) => h.hostid));

      const mappedProblems: ZabbixProblem[] = rawProblems
        .map((p) => {
          const host = p.hosts?.[0];
          const hostid = host?.hostid ?? '';
          return {
            eventid: p.eventid,
            name: p.name,
            severity: parseInt(p.severity, 10) as ZabbixSeverity,
            clock: parseInt(p.clock, 10),
            acknowledged: p.acknowledged === '1',
            objectid: p.objectid,
            hostid,
            hostName: host?.name ?? hostMap.get(hostid) ?? i18n('unknown_host'),
            instanceId: instance.id,
            instanceAlias: instance.alias,
            environment: hostid
              ? (hostEnvById.get(hostid) ?? BUILTIN_ENVIRONMENT_IDS.OTHER)
              : BUILTIN_ENVIRONMENT_IDS.OTHER,
          };
        })
        .filter((p) => !p.hostid || knownHostIds.has(p.hostid));

      const previous = this.problems;
      this.problems = mappedProblems;
      this.hosts = mappedHosts;

      const now = Date.now();
      await cacheProblems(
        mappedProblems.map((p) => ({
          eventid: p.eventid,
          instanceId: p.instanceId,
          name: p.name,
          severity: p.severity,
          clock: p.clock,
          acknowledged: p.acknowledged,
          hostid: p.hostid,
          hostName: p.hostName,
          environment: p.environment,
          updatedAt: now,
        })),
      );
      await cacheHosts(
        mappedHosts.map((h) => ({
          hostid: h.hostid,
          instanceId: h.instanceId,
          name: h.name,
          status: h.status,
          updatedAt: now,
        })),
      );

      if (!this.firstPoll) {
        const newProblems = filterNewItemsById(previous, mappedProblems, 'eventid');
        for (const problem of newProblems) {
          const snoozed = await SnoozeManager.isSnoozed(problem.instanceId, problem.eventid);
          if (snoozed) continue;
          const notifier = new ProblemNotifier(problem, instance, (sound, volume) => {
            this.delegate.onEvent(ServiceEventType.NEED_PLAY_SOUND, {
              selected: sound,
              volumeSound: volume,
            });
          });
          notifier.fire();
        }
      }
      this.firstPoll = false;

      this.delegate.onEvent(ServiceEventType.PROBLEMS_UPDATED, mappedProblems);
      this.delegate.onEvent(ServiceEventType.HOSTS_UPDATED, mappedHosts);

      const pollInterval = Prefs.get().pollIntervalMs ?? Constants.SERVICE.POLL_INTERVAL_MS;
      this.planState(ServiceState.POLL_WAIT, pollInterval);
    } catch (e) {
      log.error('Poll failed', e);
      if (e instanceof AuthError) {
        this.delegate.onEvent(ServiceEventType.INVALID_LOGIN);
        this.addError(RequestStatus.AUTH_REQUIRED, e.message);
        this.planState(ServiceState.CONNECT_WAIT, 0);
      } else {
        this.delegate.onEvent(ServiceEventType.REQUEST_FAILED);
        this.addError(
          e instanceof ZabbixError ? e.code : RequestStatus.INTERNAL_ERROR,
          e instanceof Error ? e.message : String(e),
        );
        const pollInterval = Prefs.get().pollIntervalMs ?? Constants.SERVICE.POLL_INTERVAL_MS;
        this.planState(ServiceState.POLL_WAIT, pollInterval);
      }
    }
  }

  async clearCache(): Promise<void> {
    await clearInstanceCache(this.delegate.instanceId);
  }
}

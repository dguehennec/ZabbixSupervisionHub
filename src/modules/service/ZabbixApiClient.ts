// ============================================================
// modules/service/ZabbixApiClient.ts — Zabbix JSON-RPC client
// ============================================================

import {
  AuthError,
  NetworkError,
  RequestStatus,
  ZabbixError,
  ZabbixEventRaw,
  ZabbixHostRaw,
  ZabbixJsonRpcRequest,
  ZabbixJsonRpcResponse,
  ZabbixProblemRaw,
  ZabbixTriggerRaw,
  HostFetchFilter,
  ProblemFetchFilter,
} from '../../types';
import { Constants } from '../constant/constants';
import { Logger } from './Logger';
import { normalizeApiUrl, withRetry } from './Util';

const log = new Logger('ZabbixApiClient');

let _requestId = 1;

function parseMajorMinor(version: string): { major: number; minor: number } {
  const [major = 0, minor = 0] = version.split('.').map((part) => parseInt(part, 10) || 0);
  return { major, minor };
}

/** Zabbix 7.2+ removed body.auth — Bearer header is mandatory. */
export function requiresBearerAuth(apiVersion: string): boolean {
  const { major, minor } = parseMajorMinor(apiVersion);
  return major > 7 || (major === 7 && minor >= 2);
}

/** Zabbix 7.0+ removed selectHosts from problem.get — use event.get instead. */
export function supportsProblemSelectHosts(apiVersion: string): boolean {
  const { major } = parseMajorMinor(apiVersion);
  return major < 7;
}

function isAuthRpcError(error: { code: number; message: string; data?: string }): boolean {
  const message = error.message ?? '';
  const data = String(error.data ?? '');
  if (/not authorized|session terminated|re-login|login name or password/i.test(message)) {
    return true;
  }
  if (/not authorized|session terminated|re-login|login name or password/i.test(data)) {
    return true;
  }
  return false;
}

function asArray<T>(value: T | null | undefined): T {
  if (value == null) return [] as T;
  return value;
}

function redactRpcBody(body: ZabbixJsonRpcRequest): Record<string, unknown> {
  const copy = { ...body, params: { ...(body.params as Record<string, unknown>) } };
  if ('auth' in copy) {
    copy.auth = '[redacted]';
  }
  return copy as Record<string, unknown>;
}

export class ZabbixApiClient {
  private authToken: string | null = null;
  private apiVersion = '';
  private readonly inFlight = new Set<AbortController>();
  readonly apiUrl: string;

  constructor(apiUrl: string) {
    this.apiUrl = normalizeApiUrl(apiUrl);
  }

  get isAuthenticated(): boolean {
    return this.authToken !== null;
  }

  get token(): string | null {
    return this.authToken;
  }

  getVersionString(): string {
    return this.apiVersion;
  }

  setApiVersion(version: string): void {
    this.apiVersion = version;
  }

  abort(): void {
    for (const controller of this.inFlight) {
      controller.abort();
    }
    this.inFlight.clear();
    this.authToken = null;
  }

  async login(username: string, password: string): Promise<string> {
    const token = await this.call<string>('user.login', { username, password }, false);
    if (!token) throw new AuthError('Login returned empty token');
    this.authToken = token;
    return token;
  }

  /** Authenticate with a pre-generated Zabbix API token (no user.login). */
  async authenticateWithApiToken(apiToken: string): Promise<string> {
    const token = apiToken.trim();
    if (!token) throw new AuthError('API token is empty');
    if (!this.apiVersion) {
      await this.getVersion();
    }
    this.authToken = token;
    await this.call('user.get', { output: ['userid'], limit: 1 });
    return token;
  }

  async logout(): Promise<void> {
    if (!this.authToken) return;
    try {
      await this.call('user.logout', {}, true);
    } catch {
      // ignore logout errors
    } finally {
      this.authToken = null;
    }
  }

  async getVersion(): Promise<string> {
    const version = await this.call<string>('apiinfo.version', {}, false);
    this.apiVersion = version;
    return version;
  }

  async getProblems(filter: ProblemFetchFilter = {}): Promise<ZabbixProblemRaw[]> {
    const params: Record<string, unknown> = {
      output: Constants.ZABBIX.PROBLEM_OUTPUT,
      sortfield: ['eventid'],
      sortorder: 'DESC',
      recent: true,
      suppressed: false,
    };
    if (supportsProblemSelectHosts(this.apiVersion)) {
      params.selectHosts = ['hostid', 'name'];
    }

    let problems = asArray(await this.call<ZabbixProblemRaw[]>('problem.get', params));

    if (!supportsProblemSelectHosts(this.apiVersion) && problems.length > 0) {
      problems = await this.attachHostsToProblems(problems);
    }

    if (filter.excludeDisabledTriggers !== false && problems.length > 0) {
      problems = await this.filterProblemsByMonitoredTriggers(problems);
    }

    return problems;
  }

  /** Zabbix UI hides problems from disabled triggers/items — problem.get does not. */
  private async filterProblemsByMonitoredTriggers(
    problems: ZabbixProblemRaw[],
  ): Promise<ZabbixProblemRaw[]> {
    const triggerIds = [...new Set(problems.map((p) => p.objectid).filter(Boolean))];
    if (!triggerIds.length) return problems;

    const monitored = asArray(
      await this.call<ZabbixTriggerRaw[]>('trigger.get', {
        output: ['triggerid'],
        triggerids: triggerIds,
        monitored: true,
        filter: { status: 0 },
      }),
    );
    const monitoredIds = new Set(monitored.map((t) => t.triggerid));
    return problems.filter((p) => monitoredIds.has(p.objectid));
  }

  private async attachHostsToProblems(problems: ZabbixProblemRaw[]): Promise<ZabbixProblemRaw[]> {
    const eventids = problems.map((p) => p.eventid);
    const events = asArray(
      await this.call<Array<{ eventid: string; hosts?: Array<{ hostid: string; name: string }> }>>(
        'event.get',
        {
          eventids,
          output: ['eventid'],
          selectHosts: ['hostid', 'name'],
        },
      ),
    );
    const hostsByEvent = new Map(events.map((e) => [e.eventid, e.hosts ?? []]));
    return problems.map((p) => ({
      ...p,
      hosts: hostsByEvent.get(p.eventid) ?? p.hosts,
    }));
  }

  async getHosts(filter: HostFetchFilter = {}): Promise<ZabbixHostRaw[]> {
    const excludeDisabled = filter.excludeDisabledHosts !== false;
    const excludeMaintenance = filter.excludeMaintenanceHosts === true;

    const params: Record<string, unknown> = {
      output: Constants.ZABBIX.HOST_OUTPUT,
      monitored_hosts: true,
      selectHostGroups: ['groupid', 'name'],
      sortfield: 'name',
    };

    const apiFilter: Record<string, number> = {};
    if (excludeDisabled) {
      apiFilter.status = 0;
    }
    if (excludeMaintenance) {
      apiFilter.maintenance_status = 0;
    }
    if (Object.keys(apiFilter).length > 0) {
      params.filter = apiFilter;
    }

    const result = await this.call<ZabbixHostRaw[]>('host.get', params);
    return asArray(result);
  }

  async getEvents(hostid: string, limit = 50): Promise<ZabbixEventRaw[]> {
    const result = await this.call<ZabbixEventRaw[]>('event.get', {
      output: Constants.ZABBIX.EVENT_OUTPUT,
      hostids: [hostid],
      sortfield: ['clock'],
      sortorder: 'DESC',
      limit,
    });
    return asArray(result);
  }

  async acknowledgeEvents(eventids: string[], message: string): Promise<boolean> {
    return this.call<boolean>('event.acknowledge', {
      eventids,
      action: 6,
      message,
    });
  }

  async testConnection(username: string, password: string): Promise<{ version: string; token: string }> {
    const version = await this.getVersion();
    const token = await this.login(username, password);
    await this.logout();
    return { version, token };
  }

  async testConnectionWithApiToken(apiToken: string): Promise<{ version: string; token: string }> {
    const version = await this.getVersion();
    const token = await this.authenticateWithApiToken(apiToken);
    return { version, token };
  }

  private async call<T>(
    method: string,
    params: Record<string, unknown>,
    useAuth = true,
  ): Promise<T> {
    return withRetry(() => this.doCall<T>(method, params, useAuth), {
      shouldRetry: (err) => {
        if (err instanceof ZabbixError && err.code === RequestStatus.CANCELED) return false;
        return err instanceof NetworkError && err.retriable;
      },
    });
  }

  private async doCall<T>(
    method: string,
    params: Record<string, unknown>,
    useAuth: boolean,
  ): Promise<T> {
    const abortController = new AbortController();
    this.inFlight.add(abortController);

    const body: ZabbixJsonRpcRequest = {
      jsonrpc: '2.0',
      method,
      params,
      id: _requestId++,
    };

    const headers: Record<string, string> = { 'Content-Type': 'application/json-rpc' };
    if (useAuth && this.authToken) {
      // 6.4–7.1: body.auth (Bearer is often stripped by Apache/PHP-FPM — ZBX-22952).
      // 7.2+: body.auth removed; Bearer header required.
      if (requiresBearerAuth(this.apiVersion)) {
        headers.Authorization = `Bearer ${this.authToken}`;
      } else {
        body.auth = this.authToken;
      }
    }

    log.traceRequest(`RPC ${method}`, redactRpcBody(body));

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: abortController.signal,
      });

      if (!response.ok) {
        throw new NetworkError(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      const json = JSON.parse(text) as ZabbixJsonRpcResponse<T>;

      if (json.error) {
        const msg = String(json.error.data ?? json.error.message);
        if (isAuthRpcError(json.error)) {
          throw new AuthError(msg);
        }
        throw new ZabbixError(RequestStatus.SERVER_ERROR, msg, json.error.code);
      }

      return json.result as T;
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new ZabbixError(RequestStatus.CANCELED, 'Request aborted');
      }
      if (e instanceof ZabbixError || e instanceof NetworkError) throw e;
      throw new NetworkError(`Network error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.inFlight.delete(abortController);
    }
  }
}

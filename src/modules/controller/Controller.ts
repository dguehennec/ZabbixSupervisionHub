// ============================================================
// modules/controller/Controller.ts
// ============================================================

import {
  ServiceEventType,
  ControllerInfo,
  ZabbixProblem,
  ZabbixHost,
  ZabbixEvent,
  SessionInfo,
  ErrorEntry,
  ZabbixInstanceConfig,
  ZabbixSeverity,
} from '../../types';
import { Logger } from '../service/Logger';
import { Service, ServiceDelegate } from './Service';
import { BrowserService } from '../service/BrowserService';
import { getOriginUrl } from '../service/Util';

const log = new Logger('Controller');

export type RefreshCallback = (event: ServiceEventType, data?: unknown) => void;

export class Controller implements ServiceDelegate {
  private service: Service;
  private callbacks: RefreshCallback[] = [];

  constructor(
    public readonly id: string,
    public readonly instanceId: string,
  ) {
    this.service = new Service(this);
  }

  onEvent(event: ServiceEventType, data?: unknown): void {
    log.trace(`Event: ${event}`);
    this.callbacks.forEach((cb) => cb(event, data));
  }

  onSessionChanged(info: SessionInfo): void {
    log.info('Session changed', { version: info.version });
  }

  getInstance(): ZabbixInstanceConfig | null {
    return this.service.getInstance();
  }

  isConnected(): boolean {
    return this.service.isConnected();
  }

  isConnecting(): boolean {
    return this.service.isConnecting();
  }

  getProblems(): ZabbixProblem[] {
    return this.service.getProblems();
  }

  getHosts(): ZabbixHost[] {
    return this.service.getHosts();
  }

  getLastErrorMessage(): ErrorEntry | null {
    return this.service.getLastErrorMessage();
  }

  getZabbixVersion(): string {
    return this.service.getSessionInfo().version;
  }

  initializeConnection(password: string | undefined): void {
    this.service.initializeConnection(password);
  }

  closeConnection(): void {
    this.service.closeConnection();
  }

  checkNow(): void {
    this.service.checkNow();
  }

  async acknowledgeProblem(eventid: string, message: string): Promise<boolean> {
    return this.service.acknowledgeProblem(eventid, message);
  }

  async getHostTimeline(hostid: string): Promise<ZabbixEvent[]> {
    return this.service.getHostTimeline(hostid);
  }

  private resolveWebBase(): string | null {
    const instance = this.getInstance();
    const raw = (instance?.webUrl || instance?.apiUrl || '').replace(/\/api_jsonrpc\.php$/, '');
    if (!raw) return null;
    try {
      return getOriginUrl(raw);
    } catch {
      return null;
    }
  }

  openZabbixWebInterface(): void {
    const base = this.resolveWebBase();
    if (base) BrowserService.openWebInterface(base);
  }

  openZabbixHost(hostid: string): void {
    const base = this.resolveWebBase();
    if (base && hostid) {
      const url = new URL('/zabbix.php', base);
      url.searchParams.set('action', 'host.view');
      url.searchParams.set('hostid', hostid);
      BrowserService.openWebInterface(url.toString());
    }
  }

  openZabbixProblem(eventid: string): void {
    const base = this.resolveWebBase();
    if (base && eventid) {
      const url = new URL('/zabbix.php', base);
      url.searchParams.set('action', 'problem.view');
      url.searchParams.set('eventid', eventid);
      BrowserService.openWebInterface(url.toString());
    }
  }

  addCallback(fn: RefreshCallback): void {
    this.callbacks.push(fn);
  }

  removeCallback(fn: RefreshCallback): void {
    const i = this.callbacks.indexOf(fn);
    if (i >= 0) this.callbacks.splice(i, 1);
  }

  toInfo(): ControllerInfo {
    const instance = this.getInstance();
    const problems = this.getProblems();
    const disasterCount = problems.filter((p) => p.severity === ZabbixSeverity.DISASTER).length;
    const highCount = problems.filter((p) => p.severity === ZabbixSeverity.HIGH).length;

    return {
      id: this.id,
      instanceId: this.instanceId,
      instanceAlias: instance?.alias ?? '',
      instanceApiUrl: instance?.apiUrl ?? '',
      isConnected: this.isConnected(),
      isConnecting: this.isConnecting(),
      problemCount: problems.length,
      disasterCount,
      highCount,
      problems,
      lastErrorMessage: this.getLastErrorMessage(),
      zabbixVersion: this.getZabbixVersion(),
    };
  }

  async shutdown(): Promise<void> {
    this.service.shutdown();
    await this.service.clearCache();
    this.callbacks = [];
  }
}

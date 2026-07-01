// ============================================================
// modules/controller/SuperController.ts
// ============================================================

import {
  ServiceEventType,
  ControllerInfo,
  ZabbixProblem,
  ZabbixHost,
  ZabbixEvent,
  ErrorEntry,
  ProblemGroup,
  HeatmapCell,
  InfraEnvironmentNode,
  FilterPreset,
  ZabbixAuthMethod,
  ZabbixSeverity,
  ProblemTitleHideRule,
} from '../../types';
import { Logger } from '../service/Logger';
import { Controller, RefreshCallback } from './Controller';
import { Prefs } from '../service/Prefs';
import {
  randomHex,
  computeHeatmap,
  buildInfrastructureTree,
  filterProblemsBySnooze,
  filterProblemsByMinSeverity,
  filterProblemsByAcknowledged,
  applyProblemVisibilityToControllerInfo,
  checkOriginPermission,
} from '../service/Util';
import {
  defaultEnvironments,
  filterProblemsByHiddenEnvironment,
} from '../service/Environments';
import { filterProblemsByTitleHideRules } from '../service/ProblemTitleFilters';
import { groupProblemsAsync } from '../service/CorrelationWorkerClient';
import { ZabbixApiClient } from '../service/ZabbixApiClient';
import { SnoozeManager } from '../service/SnoozeManager';
import { BrowserService } from '../service/BrowserService';

const log = new Logger('SuperController');

class SuperControllerImpl {
  private controllers: Controller[] = [];
  private globalCallbacks: RefreshCallback[] = [];

  async initialize(): Promise<void> {
    await Prefs.load();
    for (const ctrl of this.controllers) {
      await ctrl.shutdown();
    }
    this.controllers = [];

    const instances = Prefs.getInstances().filter((i) => i.enabled);
    for (const instance of instances) {
      const ctrl = new Controller(instance.id, instance.id);
      ctrl.addCallback(this.onControllerEvent.bind(this));
      this.controllers.push(ctrl);
    }
    log.info('Initialized', { controllers: this.controllers.length });

    if (Prefs.get().autoConnect) {
      for (const ctrl of this.controllers) {
        const instance = Prefs.getInstances().find((i) => i.id === ctrl.instanceId);
        if (!instance) continue;
        if ((instance.authMethod ?? ZabbixAuthMethod.PASSWORD) === ZabbixAuthMethod.API_TOKEN) {
          const apiToken = await Prefs.loadApiToken(ctrl.instanceId);
          if (apiToken) ctrl.initializeConnection(apiToken);
        } else {
          const password = await Prefs.loadPassword(ctrl.instanceId);
          if (password) ctrl.initializeConnection(password);
        }
      }
    }
  }

  private onControllerEvent(event: ServiceEventType, data?: unknown): void {
    this.globalCallbacks.forEach((cb) => cb(event, data));
  }

  getControllers(): Controller[] {
    return this.controllers;
  }

  addGlobalCallback(fn: RefreshCallback): void {
    this.globalCallbacks.push(fn);
  }

  removeGlobalCallback(fn: RefreshCallback): void {
    const i = this.globalCallbacks.indexOf(fn);
    if (i >= 0) this.globalCallbacks.splice(i, 1);
  }

  hasConnectionActivated(): boolean {
    return this.controllers.some((c) => c.isConnected() || c.isConnecting());
  }

  async getSnoozedKeys(): Promise<Set<string>> {
    return SnoozeManager.getSnoozedKeys();
  }

  getAllProblems(): ZabbixProblem[] {
    return this.controllers.flatMap((c) => c.getProblems());
  }

  async getVisibleProblems(): Promise<ZabbixProblem[]> {
    const { minSeverity, hideSnoozed, hideAcknowledged, snoozed, environments, titleHideRules } =
      await this.getProblemVisibilityContext();
    let problems = filterProblemsByMinSeverity(this.getAllProblems(), minSeverity);
    problems = filterProblemsByHiddenEnvironment(problems, environments);
    problems = filterProblemsByTitleHideRules(problems, titleHideRules);
    problems = filterProblemsByAcknowledged(problems, hideAcknowledged);
    if (hideSnoozed) {
      problems = filterProblemsBySnooze(problems, snoozed);
    }
    return problems;
  }

  private async getProblemVisibilityContext(): Promise<{
    minSeverity: ZabbixSeverity;
    hideSnoozed: boolean;
    hideAcknowledged: boolean;
    snoozed: Set<string>;
    environments: ReturnType<typeof defaultEnvironments>;
    titleHideRules: ProblemTitleHideRule[];
  }> {
    const prefs = Prefs.get();
    const hideSnoozed = prefs.hideSnoozedProblems;
    return {
      minSeverity: prefs.minSeverityDisplay ?? ZabbixSeverity.NOT_CLASSIFIED,
      hideSnoozed,
      hideAcknowledged: prefs.hideAcknowledgedProblems ?? false,
      snoozed: hideSnoozed ? await this.getSnoozedKeys() : new Set<string>(),
      environments: prefs.environments ?? defaultEnvironments(),
      titleHideRules: prefs.problemTitleHideRules ?? [],
    };
  }

  getTotalProblemCount(): number {
    return this.getAllProblems().length;
  }

  async getVisibleProblemCount(): Promise<number> {
    return (await this.getVisibleProblems()).length;
  }

  getAllHosts(): ZabbixHost[] {
    return this.controllers.flatMap((c) => c.getHosts());
  }

  getAllControllerInfos(): ControllerInfo[] {
    return this.controllers.map((c) => c.toInfo());
  }

  async getVisibleControllerInfos(): Promise<ControllerInfo[]> {
    const { minSeverity, hideSnoozed, hideAcknowledged, snoozed, environments, titleHideRules } =
      await this.getProblemVisibilityContext();
    return this.getAllControllerInfos().map((info) =>
      applyProblemVisibilityToControllerInfo(
        info,
        minSeverity,
        snoozed,
        hideSnoozed,
        environments,
        titleHideRules,
        hideAcknowledged,
      ),
    );
  }

  getLastErrorMessage(): ErrorEntry | null {
    return this.controllers.map((c) => c.getLastErrorMessage()).find((e) => e) ?? null;
  }

  async getGroupedProblemsAsync(): Promise<ProblemGroup[]> {
    const problems = await this.getVisibleProblems();
    return groupProblemsAsync(problems);
  }

  async getHeatmap(): Promise<HeatmapCell[]> {
    return computeHeatmap(await this.getVisibleProblems(), this.getAllHosts());
  }

  async getInfrastructure(): Promise<InfraEnvironmentNode[]> {
    const prefs = Prefs.get();
    return buildInfrastructureTree(
      await this.getVisibleProblems(),
      this.getAllHosts(),
      await this.getVisibleControllerInfos(),
      prefs.favoriteHostIds,
      prefs.environments ?? defaultEnvironments(),
    );
  }

  getKnownHostGroups(): string[] {
    const names = new Set<string>();
    for (const ctrl of this.controllers) {
      for (const host of ctrl.getHosts()) {
        for (const groupName of host.groupNames) {
          if (groupName.trim()) names.add(groupName);
        }
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  async getHostTimeline(instanceId: string, hostid: string): Promise<ZabbixEvent[]> {
    const ctrl = this.controllers.find((c) => c.instanceId === instanceId);
    if (!ctrl) return [];
    return ctrl.getHostTimeline(hostid);
  }

  async acknowledgeProblem(instanceId: string, eventid: string, message: string): Promise<boolean> {
    const ctrl = this.controllers.find((c) => c.instanceId === instanceId);
    if (!ctrl) return false;
    return ctrl.acknowledgeProblem(eventid, message);
  }

  async snoozeProblem(instanceId: string, eventid: string, durationSec: number): Promise<void> {
    await SnoozeManager.snooze(instanceId, eventid, durationSec);
  }

  async unsnoozeProblem(instanceId: string, eventid: string): Promise<void> {
    await SnoozeManager.unsnooze(instanceId, eventid);
  }

  openWarRoom(): void {
    BrowserService.openWarRoom();
  }

  findControllerByInstanceId(instanceId: string): Controller | undefined {
    return this.controllers.find((c) => c.instanceId === instanceId);
  }

  async saveFilterPreset(preset: FilterPreset): Promise<void> {
    await Prefs.saveFilterPreset(preset);
  }

  async deleteFilterPreset(presetId: string): Promise<void> {
    await Prefs.deleteFilterPreset(presetId);
  }

  async toggleFavoriteHost(hostKey: string): Promise<boolean> {
    return Prefs.toggleFavoriteHost(hostKey);
  }

  async addNewInstance(): Promise<string> {
    const newId = randomHex(8);
    await Prefs.addInstance({
      id: newId,
      alias: '',
      apiUrl: '',
      webUrl: '',
      username: '',
      passwordEncrypted: '',
      savePassword: false,
      authMethod: ZabbixAuthMethod.PASSWORD,
      apiTokenEncrypted: '',
      saveApiToken: false,
      enabled: true,
    });
    const ctrl = new Controller(newId, newId);
    ctrl.addCallback(this.onControllerEvent.bind(this));
    this.controllers.push(ctrl);
    return newId;
  }

  async removeController(ctrl: Controller): Promise<void> {
    await ctrl.shutdown();
    const i = this.controllers.indexOf(ctrl);
    if (i >= 0) this.controllers.splice(i, 1);
    await Prefs.removeInstance(ctrl.instanceId);
  }

  async testConnection(
    apiUrl: string,
    authMethod: ZabbixAuthMethod,
    username: string,
    secret: string,
  ): Promise<{ version: string }> {
    const allowed = await checkOriginPermission(apiUrl);
    if (!allowed) {
      throw new Error('Origin permission not granted');
    }
    const client = new ZabbixApiClient(apiUrl);
    try {
      if (authMethod === ZabbixAuthMethod.API_TOKEN) {
        const result = await client.testConnectionWithApiToken(secret);
        return { version: result.version };
      }
      const result = await client.testConnection(username, secret);
      return { version: result.version };
    } finally {
      client.abort();
    }
  }
}

export const SuperController = new SuperControllerImpl();

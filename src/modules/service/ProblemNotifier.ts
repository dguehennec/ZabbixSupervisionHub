// ============================================================
// modules/service/ProblemNotifier.ts — Problem notifications
// ============================================================

import { ZabbixProblem, ZabbixInstanceConfig, SoundType } from '../../types';
import { Logger } from './Logger';
import { BrowserService } from './BrowserService';
import { Prefs } from './Prefs';
import { i18n, severityLabel } from './Util';
import { defaultEnvironments, isHiddenEnvironment } from './Environments';
import { isProblemHiddenByTitleRules } from './ProblemTitleFilters';
import { defaultSoundForSeverity } from './Sounds';

const log = new Logger('ProblemNotifier');

export class ProblemNotifier {
  constructor(
    private readonly problem: ZabbixProblem,
    private readonly instance: ZabbixInstanceConfig,
    private readonly onPlaySound?: (sound: SoundType, volume: number) => void,
  ) {}

  fire(): void {
    const prefs = Prefs.get();
    if (!prefs.problemNotificationEnabled) return;
    if (this.problem.severity < prefs.minSeverityDisplay) return;
    const environments = prefs.environments ?? defaultEnvironments();
    if (isHiddenEnvironment(this.problem.environment, environments)) return;
    if (isProblemHiddenByTitleRules(this.problem, prefs.problemTitleHideRules ?? [])) return;

    const title = i18n('notification_problem_title', severityLabel(this.problem.severity));
    const instanceLabel =
      prefs.instances.length > 1
        ? ` [${this.instance.alias || this.instance.username}]`
        : '';
    const body = `${this.problem.hostName}: ${this.problem.name}${instanceLabel}`;

    log.info('Problem notification', { eventid: this.problem.eventid, severity: this.problem.severity });
    BrowserService.notify(title, body, prefs.problemNotificationDuration);

    if (prefs.problemSoundEnabled) {
      const sound =
        prefs.severitySoundMap[this.problem.severity] ?? defaultSoundForSeverity(this.problem.severity);
      this.onPlaySound?.(sound, prefs.problemSoundVolume);
    }
  }
}

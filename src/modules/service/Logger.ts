// ============================================================
// modules/service/Logger.ts
// ============================================================

import { LogLevel } from '../../types';
import { Constants } from '../constant/constants';

interface LogEntry {
  ts: string;
  level: 'ERROR' | 'WARN' | 'INFO' | 'TRACE';
  module: string;
  msg: string;
  stack: string | undefined;
  data?: unknown;
}

export class Logger {
  private static level: LogLevel = Constants.LOGGER.LEVEL;
  private static printStack: boolean = Constants.LOGGER.PRINT_STACK;
  private static printData: boolean = Constants.LOGGER.PRINT_DATA_REQUEST;

  static configure(
    level: LogLevel,
    printStack: boolean = Constants.LOGGER.PRINT_STACK,
    printData: boolean = Constants.LOGGER.PRINT_DATA_REQUEST,
  ): void {
    Logger.level = level;
    Logger.printStack = printStack;
    Logger.printData = printData;
  }

  constructor(private readonly module: string) {}

  error(msg: string, data?: unknown): void {
    if (Logger.level >= LogLevel.ERROR) this.emit('ERROR', msg, data);
  }

  warn(msg: string, data?: unknown): void {
    if (Logger.level >= LogLevel.WARNING) this.emit('WARN', msg, data);
  }

  info(msg: string, data?: unknown): void {
    if (Logger.level >= LogLevel.INFO) this.emit('INFO', msg, data);
  }

  trace(msg: string, data?: unknown): void {
    if (Logger.level >= LogLevel.TRACE) this.emit('TRACE', msg, data);
  }

  traceRequest(msg: string, body?: unknown): void {
    this.trace(msg, Logger.printData ? body : undefined);
  }

  errorRequest(msg: string, body?: unknown): void {
    this.error(msg, Logger.printData ? body : undefined);
  }

  private emit(level: LogEntry['level'], msg: string, data?: unknown): void {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      module: this.module,
      msg,
      stack: undefined,
      ...(data !== undefined ? { data } : {}),
    };

    if (Logger.printStack && level === 'ERROR') {
      entry.stack = new Error().stack?.split('\n').slice(3).join('\n');
    }

    const fn =
      level === 'ERROR'
        ? console.error
        : level === 'WARN'
          ? console.warn
          : level === 'INFO'
            ? console.info
            : console.trace;

    fn('[ZabbixSupervisionHub]', JSON.stringify(entry));
  }
}

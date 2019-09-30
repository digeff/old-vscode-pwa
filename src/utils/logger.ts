// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as path from 'path';
import * as os from 'os';
import * as winston from 'winston';

export interface Logger {
  infoJSON(eventName: string, jsonMetadata: unknown);
}

class ModuleLogger {
  public constructor(private readonly _moduleName: string) { }

  public infoJSON(eventName: string, jsonMetadata: unknown) {
    underlyingLogger.infoJSON(this._moduleName, eventName, jsonMetadata);
  }
}

interface ModulePerCallLogger {
  infoJSON(moduleName: string, eventName: string, jsonMetadata: unknown);
}

class ApplicationLogger implements ModulePerCallLogger {
  private readonly _winstonLogger: winston.Logger;

  public constructor(logLevel: string) {
    this._winstonLogger = winston.createLogger({
      level: logLevel,
      format: winston.format.json(),
      defaultMeta: { service: 'user-service' },
      transports:
        logLevel !== 'none'
        ? [new winston.transports.File({ filename: path.join(os.tmpdir(), 'vscode-pwa.log') })]
        : []
    });
  }

  public infoJSON(moduleName: string, eventName: string, jsonMetadata: unknown) {
    this._winstonLogger.log({ level: 'info', module: moduleName, now: Date.now(), message: eventName, metadata: jsonMetadata });
  }
}

class BufferCallsLogger implements ModulePerCallLogger {
  private readonly _calls: ((otherLogger: ModulePerCallLogger) => void)[] = [];

  public infoJSON(moduleName: string, eventName: string, jsonMetadata: unknown) {
    this._calls.push(otherLogger => otherLogger.infoJSON(moduleName, eventName, jsonMetadata));
  }

  public makeCallsTo(otherLogger: ModulePerCallLogger) {
    this._calls.forEach(call => call(otherLogger));
  }
}

let bufferCallsLogger = new BufferCallsLogger();
let underlyingLogger: ModulePerCallLogger = bufferCallsLogger;

/**
 * Create a logger extracting the module name form the filepath. Usage:
 * const logger = loggerForFile(__filename);
*/
export function loggerForFile(filepath: string): Logger {
  return loggerForModule(path.basename(filepath));
}

/**
 * Create a logger for a module
 * const logger = loggerForModule('DAP');
*/
export function loggerForModule(moduleName: string): Logger {
  return new ModuleLogger(moduleName);
}

/**
 * Configure the logger level
*/
export function configureLoggerLevel(logLevel: string): void {
  const applicationLogger = new ApplicationLogger(logLevel);
  bufferCallsLogger.makeCallsTo(applicationLogger);
  underlyingLogger = applicationLogger;

  bufferCallsLogger = new BufferCallsLogger(); // Let's clear the call's buffer
}

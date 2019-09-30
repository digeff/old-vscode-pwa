// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as path from 'path';
import * as os from 'os';
import * as winston from 'winston';

export interface Logger {
  infoJSON(eventName: string, jsonMetadata: unknown);
}

class ModuleLogger {
  public constructor(private readonly _moduleName: string, private readonly _wrappedLogger: ApplicationLogger) { }

  public infoJSON(eventName: string, jsonMetadata: unknown) {
    this._wrappedLogger.infoJSON(this._moduleName, eventName, jsonMetadata);
  }
}

class ApplicationLogger {
  private readonly _winstonLogger = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    defaultMeta: { service: 'user-service' },
    transports: [
      new winston.transports.File({ filename: path.join(os.tmpdir(), 'vscode-pwa.log') })
    ]
  });

  public infoJSON(moduleName: string, eventName: string, jsonMetadata: unknown) {
    this._winstonLogger.log({ level: 'info', module: moduleName, now: Date.now(), message: eventName, metadata: jsonMetadata });
  }
}

const applicationLogger = new ApplicationLogger();

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
  return new ModuleLogger(moduleName, applicationLogger);
}

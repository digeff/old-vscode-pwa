// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Disposable, EventEmitter } from '../../common/events';
import CdpConnection from '../../cdp/connection';
import * as launcher from './launcher';
import { BrowserTarget, BrowserTargetManager } from './browserTargets';
import { Target, Launcher, LaunchResult } from '../targets';
import { BrowserSourcePathResolver } from './browserPathResolver';
import { baseURL, LaunchParams } from './browserLaunchParams';
import { CommonLaunchParams } from '../../common/commonLaunchParams';
import { RawTelemetryReporterToDap } from '../../telemetry/telemetryReporter';

export class BrowserAttacher implements Launcher {
  private _attemptTimer: NodeJS.Timer | undefined;
  private _connection: CdpConnection | undefined;
  private _targetManager: BrowserTargetManager | undefined;
  private _launchParams: LaunchParams | undefined;
  private _targetOrigin: any;
  private _disposables: Disposable[] = [];
  private _onTerminatedEmitter = new EventEmitter<void>();
  readonly onTerminated = this._onTerminatedEmitter.event;
  private _onTargetListChangedEmitter = new EventEmitter<void>();
  readonly onTargetListChanged = this._onTargetListChangedEmitter.event;

  targetManager(): BrowserTargetManager | undefined {
    return this._targetManager;
  }

  dispose() {
    for (const disposable of this._disposables)
      disposable.dispose();
    this._disposables = [];
    if (this._attemptTimer)
      clearTimeout(this._attemptTimer);
    if (this._targetManager)
      this._targetManager.dispose();
  }

  async launch(params: CommonLaunchParams, targetOrigin: any, rawTelemetryReporter: RawTelemetryReporterToDap): Promise<LaunchResult> {
    if (!('remoteDebuggingPort' in params) && !('port' in params))
      return { blockSessionTermination: false };

    this._launchParams = params;
    this._targetOrigin = targetOrigin;
    this._attemptToAttach(rawTelemetryReporter);
    return { blockSessionTermination: false };
  }

  _scheduleAttach(rawTelemetryReporter: RawTelemetryReporterToDap) {
    this._attemptTimer = setTimeout(() => {
      this._attemptTimer = undefined;
      this._attemptToAttach(rawTelemetryReporter);
    }, 1000);
  }

  async _attemptToAttach(rawTelemetryReporter: RawTelemetryReporterToDap) {
    const params = this._launchParams!;
    let connection: CdpConnection | undefined;
    try {
      connection = await launcher.attach({ browserURL: `http://localhost:${params.remoteDebuggingPort || params.port}` }, rawTelemetryReporter);
    } catch (e) {
    }
    if (!connection) {
      this._scheduleAttach(rawTelemetryReporter);
      return;
    }

    if (params.logging)
      connection.setLogConfig(params.remoteDebuggingPort || params.port || '', params.logging.cdp);
    this._connection = connection;
    connection.onDisconnected(() => {
      this._connection = undefined;
      if (this._targetManager) {
        this._targetManager.dispose();
        this._targetManager = undefined;
        this._onTargetListChangedEmitter.fire();
      }
      if (this._launchParams)
        this._scheduleAttach(rawTelemetryReporter);
    }, undefined, this._disposables);

    const pathResolver = new BrowserSourcePathResolver(baseURL(params), params.webRoot || params.rootPath);
    this._targetManager = await BrowserTargetManager.connect(connection, pathResolver, this._targetOrigin);
    if (!this._targetManager)
      return;

    this._targetManager.serviceWorkerModel.onDidChange(() => this._onTargetListChangedEmitter.fire());
    this._targetManager.frameModel.onFrameNavigated(() => this._onTargetListChangedEmitter.fire());
    this._targetManager.onTargetAdded((target: BrowserTarget) => {
      this._onTargetListChangedEmitter.fire();
    });
    this._targetManager.onTargetRemoved((target: BrowserTarget) => {
      this._onTargetListChangedEmitter.fire();
    });
    this._targetManager.waitForMainTarget();
  }

  async terminate(): Promise<void> {
    this._launchParams = undefined;
    if (this._connection)
      this._connection.close();
  }

  async disconnect(): Promise<void> {
  }

  async restart(): Promise<void> {
  }

  targetList(): Target[] {
    const manager = this.targetManager();
    return manager ? manager.targetList() : [];
  }
}

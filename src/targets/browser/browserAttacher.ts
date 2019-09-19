// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import CdpConnection from '../../cdp/connection';
import * as launcher from './launcher';
import { BrowserTarget, BrowserTargetManager } from './browserTargets';
import { Target, Launcher } from '../targets';
import { BrowserSourcePathResolver } from './browserPathResolver';
import { baseURL, LaunchParams } from './browserLaunchParams';
import { Subject, Subscription } from 'rxjs';
import { first } from 'rxjs/operators';

export class BrowserAttacher implements Launcher {
  private _rootPath: string | undefined;
  private _attemptTimer: NodeJS.Timer | undefined;
  private _connection: CdpConnection | undefined;
  private _targetManager: BrowserTargetManager | undefined;
  private _subscriptions: Subscription[] = [];
  private _launchParams: LaunchParams | undefined;
  private _targetOrigin: any;
  private _onTerminatedEmitter = new Subject<void>();
  readonly onTerminated = this._onTerminatedEmitter.asObservable();
  private _onTargetListChangedEmitter = new Subject<void>();
  readonly onTargetListChanged = this._onTargetListChangedEmitter.asObservable();

  constructor(rootPath: string | undefined) {
    this._rootPath = rootPath;
  }

  targetManager(): BrowserTargetManager | undefined {
    return this._targetManager;
  }

  dispose() {
    this._subscriptions.forEach(x => x.unsubscribe());
    if (this._attemptTimer)
      clearTimeout(this._attemptTimer);
    if (this._targetManager)
      this._targetManager.dispose();
  }

  async launch(params: any, targetOrigin: any): Promise<boolean> {
    if (params.port == null)
      return false;

    this._launchParams = params;
    this._targetOrigin = targetOrigin;
    this._attemptToAttach();
    return false;  // Do not block session on termination.
  }

  _scheduleAttach() {
    this._attemptTimer = setTimeout(() => {
      this._attemptTimer = undefined;
      this._attemptToAttach();
    }, 1000);
  }

  async _attemptToAttach() {
    const params = this._launchParams!;
    let connection: CdpConnection | undefined;
    try {
      connection = await launcher.attach({ browserURL: `http://localhost:${params.port}` });
    } catch (e) {
    }
    if (!connection) {
      this._scheduleAttach();
      return;
    }

    this._connection = connection;
    connection.onDisconnected.pipe(first()).subscribe(() => {
      this._connection = undefined;
      if (this._targetManager) {
        this._targetManager.dispose();
        this._targetManager = undefined;
        this._onTargetListChangedEmitter.next();
      }
      if (this._launchParams)
        this._scheduleAttach();
    });

    const pathResolver = new BrowserSourcePathResolver(baseURL(params), params.webRoot || this._rootPath);
    this._targetManager = await BrowserTargetManager.connect(connection, pathResolver, this._targetOrigin);
    if (!this._targetManager)
      return;

    this._subscriptions.push(this._targetManager.serviceWorkerModel.onDidChange.subscribe(() => this._onTargetListChangedEmitter.next()));
    this._subscriptions.push(this._targetManager.frameModel.onFrameNavigated.subscribe(() => this._onTargetListChangedEmitter.next()));
    this._subscriptions.push(this._targetManager.onTargetAdded.subscribe((target: BrowserTarget) => {
      this._onTargetListChangedEmitter.next();
    }));
    this._subscriptions.push(this._targetManager.onTargetRemoved.subscribe((target: BrowserTarget) => {
      this._onTargetListChangedEmitter.next();
    }));
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

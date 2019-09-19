// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Disposable } from 'vscode';
import * as nls from 'vscode-nls';
import Dap from '../dap/api';
import * as sourceUtils from '../utils/sourceUtils';
import * as urlUtils from '../utils/urlUtils';
import * as errors from '../dap/errors';
import { UiLocation, SourceContainer, ISourceContainer } from './sources';
import { Thread, UIDelegate, ThreadDelegate, PauseOnExceptionsState } from './threads';
import { VariableStore } from './variables';
import { BreakpointManager, IBreakpointManager } from './breakpoints';
import { Cdp } from '../cdp/api';
import { CustomBreakpointId } from './customBreakpoints';
import { ChromeDebugAdapter } from 'vscode-chrome-debug-core';
import { DapApiToChromeDebugSessionAdapter } from './v3/chromeDebugSession';
import { NullExecutionTimingsReporter } from './v3/executionTimingsReporter';
import { NullTelemetryPropertyCollector } from './v3/telemetryPropertyCollector';
import { customizedChromeDebugOptions } from './v3/chromeDebugOptions';

const localize = nls.loadMessageBundle();
const revealUiLocationThreadId = 999999999;

export interface DebugAdapter {
  readonly sourceContainer: ISourceContainer;
  readonly breakpointManager: IBreakpointManager;
  readonly dap: Dap.Api;

  createThread(threadName: string, cdp: Cdp.Api, delegate: ThreadDelegate): Promise<Thread>;

  enableCustomBreakpoints(ids: CustomBreakpointId[]): Promise<void>;
  disableCustomBreakpoints(ids: CustomBreakpointId[]): Promise<void>;
  revealUiLocation(uiLocation: UiLocation, revealConfirmed: Promise<void>);

  dispose();
}

// This class collects configuration issued before "launch" request,
// to be applied after launch.
export class DebugAdapterImplementation implements DebugAdapter {
  readonly dap: Dap.Api;
  readonly sourceContainer: SourceContainer;
  readonly breakpointManager: BreakpointManager;
  private _uiLocationToReveal: UiLocation | undefined;
  private _disposables: Disposable[] = [];
  private _pauseOnExceptionsState: PauseOnExceptionsState = 'none';
  private _customBreakpoints = new Set<string>();
  private _thread: Thread | undefined;
  private _uiDelegate: UIDelegate;

  private _initializeParams: Dap.InitializeParams | undefined;
  private _v3DebugAdapter: ChromeDebugAdapter | undefined;

  private readonly _telemetryCollector = new NullTelemetryPropertyCollector;

  constructor(dap: Dap.Api, rootPath: string | undefined, uiDelegate: UIDelegate) {
    this.dap = dap;
    this._uiDelegate = uiDelegate;
    rootPath = urlUtils.platformPathToPreferredCase(rootPath);
    this.dap.on('setBreakpoints', params => this._onSetBreakpoints(params));
    this.dap.on('setExceptionBreakpoints', params => this._onSetExceptionBreakpoints(params));
    this.dap.on('configurationDone', params => this._onConfigurationDone(params));
    this.dap.on('loadedSources', params => this._onLoadedSources(params));
    this.dap.on('source', params => this._onSource(params));
    this.dap.on('threads', params => this._onThreads(params));
    this.dap.on('stackTrace', params => this._onStackTrace(params));
    this.dap.on('variables', params => this._onVariables(params));
    this.dap.on('setVariable', params => this._onSetVariable(params));
    this.dap.on('continue', params => this._withThread(thread => thread.resume()));
    this.dap.on('pause', params => this._withThread(thread => thread.pause()));
    this.dap.on('next', params => this._withThread(thread => thread.stepOver()));
    this.dap.on('stepIn', params => this._withThread(thread => thread.stepInto()));
    this.dap.on('stepOut', params => this._withThread(thread => thread.stepOut()));
    this.dap.on('restartFrame', params => this._withThread(thread => thread.restartFrame(params)));
    this.dap.on('scopes', params => this._withThread(thread => thread.scopes(params)));
    this.dap.on('evaluate', params => this._withThread(thread => thread.evaluate(params)));
    this.dap.on('completions', params => this._withThread(thread => thread.completions(params)));
    this.dap.on('exceptionInfo', params => this._withThread(thread => thread.exceptionInfo()));
    this.sourceContainer = new SourceContainer(this.dap, rootPath);
    this.breakpointManager = new BreakpointManager(this.dap, this.sourceContainer);

    // TODO PWA: await this._v3DebugAdapter!.processRequest('initialize', this._initializeParams, this._telemetryCollector);

    this.dap.initialized({});
  }

  private async _onSetBreakpoints(params: Dap.SetBreakpointsParams): Promise<Dap.SetBreakpointsResult | Dap.Error> {
    await this._v3DebugAdapter!.processRequest('setBreakpoints', params, this._telemetryCollector);
    return this.breakpointManager.setBreakpoints(params);
  }

  private async _onSetExceptionBreakpoints(params: Dap.SetExceptionBreakpointsParams): Promise<Dap.SetExceptionBreakpointsResult> {
    this._pauseOnExceptionsState = 'none';
    if (params.filters.includes('caught'))
      this._pauseOnExceptionsState = 'all';
    else if (params.filters.includes('uncaught'))
      this._pauseOnExceptionsState = 'uncaught';
    if (this._thread)
      await this._thread.setPauseOnExceptionsState(this._pauseOnExceptionsState);
    return {};
  }

  private async _onConfigurationDone(_: Dap.ConfigurationDoneParams): Promise<Dap.ConfigurationDoneResult> {
    return {};
  }

  private async _onLoadedSources(_: Dap.LoadedSourcesParams): Promise<Dap.LoadedSourcesResult> {
    return { sources: await this.sourceContainer.loadedSources() };
  }

  private async _onSource(params: Dap.SourceParams): Promise<Dap.SourceResult | Dap.Error> {
    params.source!.path = urlUtils.platformPathToPreferredCase(params.source!.path);
    const source = this.sourceContainer.source(params.source!);
    if (!source)
      return errors.createSilentError(localize('error.sourceNotFound', 'Source not found'));
    const content = await source.content();
    if (content === undefined)
      return errors.createSilentError(localize('error.sourceContentDidFail', 'Unable to retrieve source content'));
    return { content, mimeType: source.mimeType() };
  }

  private async _onThreads(_: Dap.ThreadsParams): Promise<Dap.ThreadsResult | Dap.Error> {
    const threads: Dap.Thread[] = [];
    if (this._thread)
      threads.push({ id: 0, name: this._thread.name() });
    if (this._uiLocationToReveal)
      threads.push({ id: revealUiLocationThreadId, name: '' });
    return { threads };
  }

  private async _onStackTrace(params: Dap.StackTraceParams): Promise<Dap.StackTraceResult | Dap.Error> {
    if (params.threadId === revealUiLocationThreadId)
      return this._syntheticStackTraceForSourceReveal(params);
    if (!this._thread)
      return this._threadNotAvailableError();
    return this._thread.stackTrace(params);
  }

  private _findVariableStore(variablesReference: number): VariableStore | undefined {
    if (!this._thread)
      return;
    if (this._thread.pausedVariables() && this._thread.pausedVariables()!.hasVariables(variablesReference))
      return this._thread.pausedVariables();
    if (this._thread.replVariables.hasVariables(variablesReference))
      return this._thread.replVariables;
  }

  private async _onVariables(params: Dap.VariablesParams): Promise<Dap.VariablesResult> {
    let variableStore = this._findVariableStore(params.variablesReference);
    if (!variableStore)
      return { variables: [] };
    return { variables: await variableStore.getVariables(params) };
  }

  private async _onSetVariable(params: Dap.SetVariableParams): Promise<Dap.SetVariableResult | Dap.Error> {
    let variableStore = this._findVariableStore(params.variablesReference);
    if (!variableStore)
      return errors.createSilentError(localize('error.variableNotFound', 'Variable not found'));
    params.value = sourceUtils.wrapObjectLiteral(params.value.trim());
    return variableStore.setVariable(params);
  }

  private _withThread<T>(callback: (thread: Thread) => Promise<T>): Promise<T | Dap.Error> {
    if (!this._thread)
      return Promise.resolve(this._threadNotAvailableError());
    return callback(this._thread);
  }

  public async revealUiLocation(uiLocation: UiLocation, revealConfirmed: Promise<void>) {
    // 1. Report about a new thread.
    // 2. Report that thread has stopped.
    // 3. Wait for stackTrace call, return a single frame pointing to |location|.
    // 4. Wait for the source to be opened in the editor.
    // 5. Report thread as continuted and terminated.
    if (this._uiLocationToReveal)
      return;
    this._uiLocationToReveal = uiLocation;
    this.dap.thread({ reason: 'started', threadId: revealUiLocationThreadId });
    this.dap.stopped({
      reason: 'goto',
      threadId: revealUiLocationThreadId,
      allThreadsStopped: false,
    });

    await revealConfirmed;

    this.dap.continued({ threadId: revealUiLocationThreadId, allThreadsContinued: false });
    this.dap.thread({ reason: 'exited', threadId: revealUiLocationThreadId });
    this._uiLocationToReveal = undefined;

    if (this._thread) {
      const details = this._thread.pausedDetails();
      if (details)
        this._thread.refreshStackTrace();
    }
  }

  private async _syntheticStackTraceForSourceReveal(params: Dap.StackTraceParams): Promise<Dap.StackTraceResult> {
    if (!this._uiLocationToReveal || params.startFrame)
      return { stackFrames: [] };
    return {
      stackFrames: [{
        id: 1,
        name: '',
        line: this._uiLocationToReveal.lineNumber,
        column: this._uiLocationToReveal.columnNumber,
        source: await this._uiLocationToReveal.source.toDap()
      }]
    };
  }

  private _threadNotAvailableError(): Dap.Error {
    return errors.createSilentError(localize('error.threadNotFound', 'Thread not found'));
  }

  private async createV3DebugAdapter(cdp: Cdp.Api): Promise<void> {
    this._v3DebugAdapter = new ChromeDebugAdapter(customizedChromeDebugOptions(cdp),
      new DapApiToChromeDebugSessionAdapter(this.dap), new NullExecutionTimingsReporter());
    await this._v3DebugAdapter.processRequest('initialize', this._initializeParams, this._telemetryCollector);
    await this._v3DebugAdapter.processRequest('attachToExistingConnection', {}, this._telemetryCollector);
  }

  public async createThread(threadName: string, cdp: Cdp.Api, delegate: ThreadDelegate): Promise<Thread> {
    // TODO PWA: await this._v3DebugAdapter!.processRequest('initialize', this._initializeParams, this._telemetryCollector);
    this._thread = new Thread(this.sourceContainer, threadName, cdp, this.dap, delegate, this._uiDelegate);
    this.createV3DebugAdapter(cdp);

    for (const breakpoint of this._customBreakpoints)
      this._thread.updateCustomBreakpoint(breakpoint, true);
    this._thread.setPauseOnExceptionsState(this._pauseOnExceptionsState);
    this.breakpointManager.setThread(this._thread);
    return this._thread;
  }

  public async enableCustomBreakpoints(ids: CustomBreakpointId[]): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const id of ids) {
      this._customBreakpoints.add(id);
      if (this._thread)
        promises.push(this._thread.updateCustomBreakpoint(id, true));
    }
    await Promise.all(promises);
  }

  public async disableCustomBreakpoints(ids: CustomBreakpointId[]): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const id of ids) {
      this._customBreakpoints.delete(id);
      if (this._thread)
        promises.push(this._thread.updateCustomBreakpoint(id, false));
    }
    await Promise.all(promises);
  }

  public dispose() {
    for (const disposable of this._disposables)
      disposable.dispose();
    this._disposables = [];
  }
}

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { DebugAdapter } from './adapter/debugAdapter';
import { Thread } from './adapter/threads';
import { Launcher, Target } from './targets/targets';
import { Subject, Subscription } from 'rxjs';
import { first } from 'rxjs/operators';
import { Disposable } from './events/disposable';
import { LauncherFactory as LauncherProvider } from './adapterLauncher';
import Dap from './dap/api';
import * as nls from 'vscode-nls';

const localize = nls.loadMessageBundle();

export interface BinderDelegate {
  acquireDebugAdapter(target: Target): Promise<DebugAdapter>;
  releaseDebugAdapter(target: Target, debugAdapter: DebugAdapter): void;
}

export type AdapterProvider = (dap: Dap.Api, rootPath: string) => DebugAdapter;

export class Binder implements Disposable {
  private _delegate?: BinderDelegate;
  private _subscriptions: Subscription[] = [];
  private _threads = new Map<Target, {thread: Thread, debugAdapter: DebugAdapter}>();
  private _launchers = new Set<Launcher>();
  private _terminationCount = 0;
  private _onTargetListChangedEmitter = new Subject<void>();
  readonly onTargetListChanged = this._onTargetListChangedEmitter.asObservable();
  private _debugAdapter?: DebugAdapter;
  private _targetOrigin: any;

  constructor(private delegateProvider: (root: string) => BinderDelegate, dap: Dap.Api, private adapterProvider: AdapterProvider, private launcherProvider: LauncherProvider, targetOrigin: any) {

    //this._debugAdapter = debugAdapter;
    this._targetOrigin = targetOrigin;

    dap.on('initialize', this._dapInitialize);

    dap.on('launch', async params => {
      if(!this.initialized) this.initialize(dap, params);

      await this._debugAdapter!.breakpointManager.launchBlocker();
      await Promise.all([...this._launchers].map(l => this._launch(l, params)));
      return {};
    });
    dap.on('terminate', async () => {
      await Promise.all([...this._launchers].map(l => l.terminate()));
      return {};
    });
    dap.on('disconnect', async () => {
      await Promise.all([...this._launchers].map(l => l.disconnect()));
      return {};
    });
    dap.on('restart', async () => {
      await this._restart();
      return {};
    });
  }

  initialized = false;

  initialize(dap: Dap.Api, config: any) {
    const launchers = this.launcherProvider(config);
    for (const launcher of launchers) {
      this._launchers.add(launcher);
      this._subscriptions.push(launcher.onTargetListChanged.subscribe(() => {
        const targets = this.targetList();
        this._attachToNewTargets(targets);
        this._detachOrphaneThreads(targets);
        this._onTargetListChangedEmitter.next();
      }));
    };

    this._delegate = this.delegateProvider(config.webRoot);
    this._debugAdapter = this.adapterProvider(dap, config.webRoot);

    this.initialized = true;
  }

  async _restart() {
    await Promise.all([...this._launchers].map(l => l.restart()));
  }

  async _launch(launcher: Launcher, params: any) {
    if (!await launcher.launch(params, this._targetOrigin))
      return;

    this._listenToTermination(launcher);
  }

  considerLaunchedForTest(launcher: Launcher) {
    this._listenToTermination(launcher);
  }

  _listenToTermination(launcher: Launcher) {
    ++this._terminationCount;
    launcher.onTerminated.pipe(first()).subscribe(() => {
      this._launchers.delete(launcher);
      this._detachOrphaneThreads(this.targetList());
      this._onTargetListChangedEmitter.next();
      --this._terminationCount;
      if (!this._terminationCount && this._debugAdapter)
        this._debugAdapter.dap.terminated({});
    });
  }

  dispose() {
    for (const subscription of this._subscriptions)
      subscription.unsubscribe();
    for (const launcher of this._launchers)
      launcher.dispose();
    this._launchers.clear();
    this._detachOrphaneThreads([]);
  }

  debugAdapter(target: Target): DebugAdapter | undefined {
    const data = this._threads.get(target);
    return data && data.debugAdapter;
  }

  thread(target: Target): Thread | undefined {
    const data = this._threads.get(target);
    return data && data.thread;
  }

  targetList(): Target[] {
    const result: Target[] = [];
    for (const delegate of this._launchers)
      result.push(...delegate.targetList());
    return result;
  }

  async attach(target: Target) {
    if (!target.canAttach())
      return;
    const cdp = await target.attach();
    if (!cdp)
      return;
    const debugAdapter = await this._delegate!.acquireDebugAdapter(target);
    if (debugAdapter !== this._debugAdapter) {
      await debugAdapter.breakpointManager.launchBlocker();
      debugAdapter.dap.on('disconnect', async () => {
        if (target.canStop())
          target.stop();
        return {};
      });
      debugAdapter.dap.on('terminate', async () => {
        if (target.canStop())
          target.stop();
        return {};
      });
      debugAdapter.dap.on('restart', async () => {
        if (target.canRestart())
          target.restart();
        else
          await this._restart();
        return {};
      });
    }
    const thread = debugAdapter.createThread(target.name(), cdp, target);
    this._threads.set(target, {thread, debugAdapter});
    cdp.Runtime.runIfWaitingForDebugger({});
  }

  async detach(target: Target) {
    if (!target.canDetach())
      return;
    await target.detach();
    const data = this._threads.get(target);
    if (!data)
      return;
    this._threads.delete(target);
    data.thread.dispose();
    if(this._delegate)
      this._delegate.releaseDebugAdapter(target, data.debugAdapter);
  }

  _attachToNewTargets(targets: Target[]) {
    for (const target of targets.values()) {
      if (!target.waitingForDebugger())
        continue;
      const thread = this._threads.get(target);
      if (!thread)
        this.attach(target);
    }
  }

  _detachOrphaneThreads(targets: Target[]) {
    const set = new Set(targets);
    for (const [target, data] of this._threads) {
      if (!set.has(target)) {
        this._threads.delete(target);
        data.thread.dispose();
        if(this._delegate)
          this._delegate.releaseDebugAdapter(target, data.debugAdapter);
      }
    }
  }


  private _dapInitialize = async (params: Dap.InitializeParams): Promise<Dap.InitializeResult | Dap.Error> => {
    console.assert(params.linesStartAt1);
    console.assert(params.columnsStartAt1);
    return {
      supportsConfigurationDoneRequest: true,
      supportsFunctionBreakpoints: false,
      supportsConditionalBreakpoints: true,
      supportsHitConditionalBreakpoints: false,
      supportsEvaluateForHovers: true,
      exceptionBreakpointFilters: [
        { filter: 'caught', label: localize('breakpoint.caughtExceptions', 'Caught Exceptions'), default: false },
        { filter: 'uncaught', label: localize('breakpoint.uncaughtExceptions', 'Uncaught Exceptions'), default: false },
      ],
      supportsStepBack: false,
      supportsSetVariable: true,
      supportsRestartFrame: true,
      supportsGotoTargetsRequest: false,
      supportsStepInTargetsRequest: false,
      supportsCompletionsRequest: true,
      supportsModulesRequest: false,
      additionalModuleColumns: [],
      supportedChecksumAlgorithms: [],
      supportsRestartRequest: true,
      supportsExceptionOptions: false,
      supportsValueFormattingOptions: false,  // This is not used by vscode.
      supportsExceptionInfoRequest: true,
      supportTerminateDebuggee: false,
      supportsDelayedStackTraceLoading: true,
      supportsLoadedSourcesRequest: true,
      supportsLogPoints: true,
      supportsTerminateThreadsRequest: false,
      supportsSetExpression: false,
      supportsTerminateRequest: false,
      completionTriggerCharacters: ['.', '[', '"', "'"]
      //supportsDataBreakpoints: false,
      //supportsReadMemoryRequest: false,
      //supportsDisassembleRequest: false,
    };
  }
}

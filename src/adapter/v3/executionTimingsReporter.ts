import { IExecutionTimingsReporter, StepProgressEventsEmitter } from 'vscode-chrome-debug-core';

export class NullExecutionTimingsReporter implements IExecutionTimingsReporter {
  public subscribeTo(_events: StepProgressEventsEmitter): void {
    // TODO PWA: throw new Error('Method not implemented.');
  }
}

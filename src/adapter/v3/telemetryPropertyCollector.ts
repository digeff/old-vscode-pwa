import { ITelemetryPropertyCollector } from 'vscode-chrome-debug-core';

export class NullTelemetryPropertyCollector implements ITelemetryPropertyCollector {
  public getProperties(): { [propertyName: string]: string; } {
    throw new Error('Method not implemented.');
  }
  public addTelemetryProperty(propertyName: string, value: string): void {
    throw new Error('Method not implemented.');
  }
}

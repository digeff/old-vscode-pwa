import { ISession, DebugProtocol } from 'vscode-chrome-debug-core';
import { Dap } from '../../dap/api';

export class DapApiToChromeDebugSessionAdapter implements ISession {
  public constructor(_dap: Dap.Api) {}

  public sendEvent(event: DebugProtocol.Event): void {
    throw new Error('Method not implemented.');
  }

  public shutdown(): void {
    throw new Error('Method not implemented.');
  }

  public sendRequest(command: string, args: any, timeout: number, cb: (response: DebugProtocol.Response) => void): void {
    throw new Error('Method not implemented.');
  }

  public dispatchRequest(request: DebugProtocol.Request): Promise<void> {
    throw new Error('Method not implemented.');
  }
}
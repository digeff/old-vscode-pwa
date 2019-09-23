// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { IChromeConnection, TerminatingReason, CDTP, ITelemetryPropertyCollector } from 'vscode-chrome-debug-core';
import { Cdp } from '../../cdp/api';

export class PWAConnectionToChromeConnection implements IChromeConnection {
  public constructor(private readonly cdp: Cdp.Api) { }

  public get api(): CDTP.ProtocolApi {
    return <CDTP.ProtocolApi><unknown>this.cdp;
  }

  public get isAttached(): boolean {
    return true;
  }

  public open(telemetryPropertyCollector: ITelemetryPropertyCollector): void {
    // Already connected. No-op
  }

  public onClose(handler: () => void): void {
    throw new Error('onClose Method not implemented.');
  }

  public close(reason: TerminatingReason): void {
    throw new Error('close Method not implemented.');
  }
}
// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { ChromeDebugOptions } from 'debugger-for-chrome';
import { DependencyInjection, TYPES } from 'vscode-chrome-debug-core';
import { PWAConnectionToChromeConnection } from './chromeConnection';
import { Cdp } from '../../cdp/api';

export function customizedChromeDebugOptions(cdp: Cdp.Api): ChromeDebugOptions {
  const options = ChromeDebugOptions;
  const original = ChromeDebugOptions.extensibilityPoints.bindAdditionalComponents;

  ChromeDebugOptions.extensibilityPoints.bindAdditionalComponents = (diContainer: DependencyInjection) => {
    original(diContainer);
    diContainer.unconfigure(TYPES.ChromeConnection);
    diContainer.configureClass(TYPES.ChromeConnection, class extends PWAConnectionToChromeConnection {
      public constructor() {
        super(cdp);
      }
    });
  };

  return options;
}

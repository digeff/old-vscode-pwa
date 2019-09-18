// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as vscode from 'vscode';
import { AdapterFactory } from '../adapterFactory';
import { UiLocation, Source, UiLocationRevealer } from '../adapter/sources';
import { DebugAdapter } from '../adapter/debugAdapter';

export class LocationRevealerUI {
  _revealRequests = new Map<Source, () => void>();

  constructor(context: vscode.ExtensionContext, factory: AdapterFactory) {
    context.subscriptions.push(vscode.window.onDidChangeActiveTextEditor(async editor => {
      if (this._revealRequests.size === 0 ||
        !editor ||
        editor.document.languageId !== 'javascript' ||
        editor.document.uri.scheme !== 'debug') {
        return;
      }

      const { source } = await factory.sourceForUri(editor.document.uri);
      if (!source)
        return;
      const callback = this._revealRequests.get(source);
      if (callback) {
        this._revealRequests.delete(source);
        callback();
      }
    }));
    factory.adapters().forEach(adapter => this._install(adapter));
    factory.onAdapterAdded.subscribe(adapter => this._install(adapter))
  }

  _install(adapter: DebugAdapter): void {
    adapter.sourceContainer.installRevealer(new Revealer(this, adapter));
  }
}

class Revealer implements UiLocationRevealer {
  private _revealerUI: LocationRevealerUI;
  private _adapter: DebugAdapter;

  constructor(revealerUI: LocationRevealerUI, adapter: DebugAdapter) {
    this._revealerUI = revealerUI;
    this._adapter = adapter;
  }

  async revealUiLocation(uiLocation: UiLocation): Promise<undefined> {
    if (this._revealerUI._revealRequests.has(uiLocation.source))
      return;
    const absolutePath = await uiLocation.source.existingAbsolutePath();
    if (absolutePath) {
      const document = await vscode.workspace.openTextDocument(absolutePath);
      if (!document)
        return;
      const editor = await vscode.window.showTextDocument(document);
      if (!editor)
        return;
      const position = new vscode.Position(uiLocation.lineNumber - 1, uiLocation.columnNumber - 1);
      editor.selection = new vscode.Selection(position, position);
      return;
    }

    const callback = new Promise<undefined>(f => this._revealerUI._revealRequests.set(uiLocation.source, f));
    this._adapter.revealUiLocation(uiLocation, callback);
    await callback;
  }
}
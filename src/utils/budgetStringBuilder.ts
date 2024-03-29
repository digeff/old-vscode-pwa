// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as stringUtils from './stringUtils';

export class BudgetStringBuilder {
  private _tokens: string[] = [];
  private _budget: number;

  constructor(budget: number) {
    this._budget = budget;
  }

  appendCanSkip(text: string) {
    if (!this.hasBudget())
      return;
    if (text.length < this._budget) {
      this._tokens.push(text);
      this._budget -= text.length;
    } else {
      this._budget = 0;
      this.appendEllipsis();
    }
  }

  appendEllipsis() {
    if (this._tokens[this._tokens.length - 1] !== '…')
      this._tokens.push('…');
  }

  appendCanTrim(text: string) {
    if (!this.hasBudget())
      return;
    const trimmed = stringUtils.trimEnd(text, this._budget)
    this._tokens.push(trimmed);
    this._budget = Math.max(0, this._budget - trimmed.length);
  }

  forceAppend(text: string) {
    this._tokens.push(text);
    this._budget = Math.max(0, this._budget - text.length);
  }

  hasBudget(): boolean {
    if (this._budget <= 0)
      this.appendEllipsis();
    return this._budget > 0;
  }

  budget(): number {
    return this._budget;
  }

  build(join?: string): string {
    return this._tokens.join(join || '');
  }

  isEmpty(): boolean {
    return !this._tokens.length;
  }
}

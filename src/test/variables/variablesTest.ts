// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { TestP } from '../test';
import Dap from '../../dap/api';
import { Logger } from '../logger';

export function addTests(testRunner) {
  // @ts-ignore unused xit/fit variables.
  const { it, fit, xit, describe, fdescribe, xdescribe } = testRunner;

  describe('basic', () => {
    it('basic object', async ({ p }: { p: TestP }) => {
      await p.launchAndLoad('blank');
      await p.logger.evaluateAndLog('({a: 1})');
      p.assertLog();
    });

    it('simple log', async ({ p }: { p: TestP }) => {
      p.launchAndLoad(`
        <script>
          console.log('Hello world');
        </script>`);
      await p.logger.logOutput(await p.dap.once('output'));
      p.assertLog();
    });

    it('clear console', async ({ p }: { p: TestP }) => {
      let complete: () => void;
      const result = new Promise(f => complete = f);
      p.launchAndLoad(`
        <script>
        console.clear();
        console.log('Hello world');
        console.clear();
        console.clear();
        console.log('Hello world');
        console.clear();
        console.error('DONE');
        </script>`);
      p.dap.on('output', async params => {
        if (params.category === 'stderr')
          complete();
        else
          await p.logger.logOutput(params);
      });

      await result;
      p.assertLog();
    });
  });

  describe('object', () => {
    it('simple array', async ({ p }: { p: TestP }) => {
      await p.launchAndLoad('blank');
      await p.logger.evaluateAndLog('var a = [1, 2, 3]; a.foo = 1; a', { logInternalInfo: true});
      p.assertLog();
    });

    it('large array', async ({ p }: { p: TestP }) => {
      await p.launchAndLoad('blank');
      await p.logger.evaluateAndLog('var a = new Array(110); a.fill(1); a', { logInternalInfo: true });
      p.assertLog();
    });

    it('get set', async ({ p }: { p: TestP }) => {
      await p.launchAndLoad('blank');
      await p.logger.evaluateAndLog(`
        const a = {};
        Object.defineProperty(a, 'getter', { get: () => {} });
        Object.defineProperty(a, 'setter', { set: () => {} });
        Object.defineProperty(a, 'accessor', { get: () => {}, set: () => {} });
        a;`);
      p.assertLog();
    });

    it('deep accessor', async ({ p }: { p: TestP }) => {
      await p.launchAndLoad('blank');
      await p.logger.evaluateAndLog(`
        class Foo { get getter() {} }
        class Bar extends Foo { }
        new Bar();`);
      p.assertLog();
    });
  });

  describe('web', () => {
    it('tags', async ({ p }: { p: TestP }) => {
      await p.launchAndLoad(`<head>
        <meta name='foo' content='bar'></meta>
        <title>Title</title>
      </head>`);
      await p.logger.evaluateAndLog('document.head.children');
      p.assertLog();
    });
  });

  describe('multiple threads', () => {
    it('worker', async ({ p }: { p: TestP }) => {
      await p.launchUrl('worker.html');
      const outputs: {output: Dap.OutputEventParams, logger: Logger}[] = [];
      outputs.push({output: await p.dap.once('output'), logger: p.logger});
      const worker = await p.worker();
      outputs.push({output: await worker.dap.once('output'), logger: worker.logger});
      outputs.push({output: await worker.dap.once('output'), logger: worker.logger});
      outputs.sort((a, b) => a.output.source!.name!.localeCompare(b.output.source!.name!));
      for (const {output, logger} of outputs)
        await logger.logOutput(output);
      p.assertLog();
    });
  });

  describe('setVariable', () => {
    it('basic', async({p} : {p: TestP}) => {
      await p.launchAndLoad('blank');
      const v = await p.logger.evaluateAndLog(`window.x = ({foo: 42}); x`);

      p.log(`\nSetting "foo" to "{bar: 17}"`);
      const response = await p.dap.setVariable({variablesReference: v.variablesReference, name: 'foo', value: '{bar: 17}'});

      const v2: Dap.Variable = {...response, variablesReference: response.variablesReference || 0, name: '<result>'};
      await p.logger.logVariable(v2);

      p.log(`\nOriginal`);
      await p.logger.logVariable(v);

      p.log(await p.dap.setVariable({variablesReference: v.variablesReference, name: 'foo', value: 'baz'}), '\nsetVariable failure: ');
      p.assertLog();
    });

    it('scope', async({p} : {p: TestP}) => {
      await p.launchAndLoad('blank');
      p.cdp.Runtime.evaluate({expression: `
        (function foo() {
          let y = 'value of y';
          let z = 'value of z';
          debugger;
        })()
      `});

      const paused = p.log(await p.dap.once('stopped'), 'stopped: ');
      const stack = await p.dap.stackTrace({threadId: paused.threadId});
      const scopes = await p.dap.scopes({frameId: stack.stackFrames[0].id});
      const scope = scopes.scopes[0];
      const v: Dap.Variable = {
        name: 'scope',
        value: scope.name,
        variablesReference: scope.variablesReference,
        namedVariables: scope.namedVariables,
        indexedVariables: scope.indexedVariables,
      };

      await p.logger.logVariable(v);

      p.log(`\nSetting "y" to "z"`);
      const response = await p.dap.setVariable({variablesReference: v.variablesReference, name: 'y', value: `z`});

      const v2: Dap.Variable = {...response, variablesReference: response.variablesReference || 0, name: '<result>'};
      await p.logger.logVariable(v2);

      p.log(`\nOriginal`);
      await p.logger.logVariable(v);

      p.assertLog();
    });
  });
}

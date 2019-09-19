import { Binder, BinderDelegate } from "./binder";
import { DebugAdapter } from "./adapter/debugAdapter";
import DapConnection from './dap/connection';
import { Target, Launcher } from "./targets/targets";
import { NodeLauncher } from "./targets/node/nodeLauncher";
import { BrowserLauncher } from "./targets/browser/browserLauncher";
import { BrowserAttacher } from "./targets/browser/browserAttacher";

import * as net from 'net';
import { TerminalDelegate } from "./abstractions/terminalDelegate";
import { Subject } from "rxjs";


//@ts-ignore
let _binder: Binder;


const dummyUIDelegate = { copyToClipboard: (txt:string) => {} };

const terminalStub = { sendText: () => {}, show: () => {}, dispose: () => {} };
const fakeTerminalDelegate: TerminalDelegate = {
  createTerminal: () => { return terminalStub },
  onDidCloseTerminal: new Subject()
}

const launcherFactory = (args: any) => {

  return [
  new NodeLauncher(args.webRoot, fakeTerminalDelegate),
  new BrowserLauncher('C:\\tempz\\blub', args.webRoot),
  new BrowserAttacher(args.webRoot),
];
}



export type LauncherFactory = (debugConfiguration: any) => Launcher[];



net.createServer(socket => {

  console.log('something connected!');
  const conn = new DapConnection(socket, socket);

  class MyBinderDelegate implements BinderDelegate {

    constructor(private rootPath: string) {}

    acquireDebugAdapter(target: Target) {
      const da = new DebugAdapter(conn.dap(), this.rootPath, dummyUIDelegate);
      target.attach().then(cdp => {
        if(cdp) {
          da.createThread(target.name(), cdp, target);
        }
      });
      return Promise.resolve(da);
    }

    releaseDebugAdapter() {
      // ??
    }
  }

  _binder = new Binder((rootPath) => new MyBinderDelegate(rootPath), conn.dap(), (dap, rootPath) => new DebugAdapter(dap, rootPath, dummyUIDelegate) , launcherFactory, '');


}).listen(4712);




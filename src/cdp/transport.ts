// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import * as net from 'net';
import WebSocket from 'ws';
import * as events from 'events';
import { CdpTelemetryReporter, RawTelemetryReporter, isRawTelemetryReporter } from '../telemetry/telemetryReporter';
import { HighResolutionTime } from '../utils/performance';

export interface Transport {
  send(message: string): void;
  close(): void;
  onmessage?: (message: string, receivedTime: HighResolutionTime) => void;
  onclose?: () => void;
}

export class PipeTransport implements Transport {
  private _pipeWrite: NodeJS.WritableStream | undefined;
  private _socket: net.Socket | undefined;
  private _pendingBuffers: Buffer[];
  private _eventListeners: any[];
  onmessage?: (message: string, receivedTime: HighResolutionTime) => void;
  onclose?: () => void;

  constructor(socket: net.Socket, rawTelemetryReporter: RawTelemetryReporter);
  constructor(pipeWrite: NodeJS.WritableStream, pipeRead: NodeJS.ReadableStream, rawTelemetryReporter: RawTelemetryReporter);

  constructor(pipeWrite: net.Socket | NodeJS.WritableStream, reporterOrPipeRead: RawTelemetryReporter | NodeJS.ReadableStream, rawTelemetryReporter?: RawTelemetryReporter) {
    this._pipeWrite = pipeWrite as NodeJS.WritableStream;

    let pipeRead: NodeJS.ReadableStream | undefined;
    if (isRawTelemetryReporter(reporterOrPipeRead)) {
      this._socket = pipeWrite as net.Socket;
      rawTelemetryReporter = reporterOrPipeRead;
    } else {
      pipeRead = reporterOrPipeRead;
    }
    const telemetryReporter = new CdpTelemetryReporter(rawTelemetryReporter!);

    this._pendingBuffers = [];
    this._eventListeners = [
      addEventListener(pipeRead || pipeWrite, 'data', buffer => this._dispatch(buffer, telemetryReporter)),
      addEventListener(pipeRead || pipeWrite, 'close', () => {
        this._pipeWrite = undefined;
        if (this.onclose)
          this.onclose.call(null);
      })
    ];
    this.onmessage = undefined;
    this.onclose = undefined;
  }

  send(message: string) {
    this._pipeWrite!.write(message);
    this._pipeWrite!.write('\0');
  }

  _dispatch(buffer: Buffer, telemetryReporter: CdpTelemetryReporter) {
    const receivedTime = process.hrtime();
    let end = buffer.indexOf('\0');
    if (end === -1) {
      this._pendingBuffers.push(buffer);
      return;
    }
    this._pendingBuffers.push(buffer.slice(0, end));
    const message = Buffer.concat(this._pendingBuffers).toString();
    if (this.onmessage)
      this.onmessage.call(null, message, receivedTime);

    let start = end + 1;
    end = buffer.indexOf('\0', start);
    while (end !== -1) {
      if (this.onmessage)
        this.onmessage.call(null, buffer.toString(undefined, start, end), receivedTime);
      start = end + 1;
      end = buffer.indexOf('\0', start);
    }
    this._pendingBuffers = [buffer.slice(start)];
  }

  async close() {
    if (this._socket)
      this._socket.destroy();
    this._socket = undefined;
    this._pipeWrite = undefined;
    removeEventListeners(this._eventListeners);
  }
}

export class WebSocketTransport implements Transport {
  private _ws: WebSocket | undefined;
  onmessage?: (message: string) => void;
  onclose?: () => void;

  static create(url: string): Promise<WebSocketTransport> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, [], {
        perMessageDeflate: false,
        maxPayload: 256 * 1024 * 1024, // 256Mb
      });
      ws.addEventListener('open', () => resolve(new WebSocketTransport(ws, url)));
      ws.addEventListener('error', reject);
    });
  }

  constructor(ws: WebSocket, wsUrl: string) {
    this._ws = ws;
    this._ws.addEventListener('message', event => {
      if (this.onmessage)
        this.onmessage.call(null, event.data);
    });
    this._ws.addEventListener('close', event => {
      if (this.onclose)
        this.onclose.call(null);
      this._ws = undefined;
    });
    // Silently ignore all errors - we don't know what to do with them.
    this._ws.addEventListener('error', () => { });
    this.onmessage = undefined;
    this.onclose = undefined;
  }

  send(message: string) {
    if (this._ws)
      this._ws.send(message);
  }

  async close(): Promise<void> {
    if (!this._ws)
      return;
    let callback: () => void;
    const result = new Promise<void>(f => callback = f);
    this._ws.addEventListener('close', () => callback());
    this._ws.close();
    return result;
  }
}

type HandlerFunction = (...args: any[]) => void;

export interface Listener {
  emitter: events.EventEmitter;
  eventName: string;
  handler: HandlerFunction;
}

export function addEventListener(emitter: events.EventEmitter, eventName: string, handler: HandlerFunction): Listener {
  emitter.on(eventName, handler);
  return { emitter, eventName, handler };
}

export function removeEventListeners(listeners: Listener[]) {
  for (const listener of listeners)
    listener.emitter.removeListener(listener.eventName, listener.handler);
  listeners.splice(0, listeners.length);
}

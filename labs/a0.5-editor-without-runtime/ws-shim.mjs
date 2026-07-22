/**
 * Minimal WebSocket server shim (no external deps) for A0.5 offline status.
 */
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';

function acceptKey(key) {
  return createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
}

function encodeTextFrame(text) {
  const payload = Buffer.from(String(text), 'utf8');
  const len = payload.length;
  if (len < 126) {
    return Buffer.concat([Buffer.from([0x81, len]), payload]);
  }
  if (len < 65536) {
    const h = Buffer.alloc(4);
    h[0] = 0x81;
    h[1] = 126;
    h.writeUInt16BE(len, 2);
    return Buffer.concat([h, payload]);
  }
  const h = Buffer.alloc(10);
  h[0] = 0x81;
  h[1] = 127;
  h.writeUInt32BE(0, 2);
  h.writeUInt32BE(len, 6);
  return Buffer.concat([h, payload]);
}

export class WebSocket extends EventEmitter {
  /** @param {import('node:net').Socket} socket */
  constructor(socket) {
    super();
    this.socket = socket;
    this.socket.on('data', () => this.emit('message'));
    this.socket.on('close', () => this.emit('close'));
    this.socket.on('error', () => this.emit('close'));
  }
  send(data) {
    if (!this.socket.writable) return;
    this.socket.write(encodeTextFrame(data));
  }
  close() {
    try {
      this.socket.end();
    } catch {
      /* ignore */
    }
  }
}

export class WebSocketServer extends EventEmitter {
  constructor() {
    super();
  }
  handleUpgrade(req, socket, _head, cb) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.destroy();
      return;
    }
    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey(String(key))}`,
      '\r\n',
    ].join('\r\n');
    socket.write(headers);
    const ws = new WebSocket(socket);
    cb(ws);
  }
}

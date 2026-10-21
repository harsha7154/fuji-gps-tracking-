/**
 * Live GPS over WebSocket — standalone GPS service (port 8070, Redis-backed,
 * no Liferay dependency).
 *
 *   URL:  {gpsWs}/ws/gps/mobile/{dispatchId}
 *         e.g. ws://13.233.171.171:8070/ws/gps/mobile/DSP-748383
 *
 * Messages the app SENDS:
 *   single fix  {"dispatchId","deviceId","vehicleId","latitude","longitude",
 *                "accuracy","speed","heading","messageId","gpsTimestamp"?}
 *                -> {"type":"ack","success":true,...}
 *   batch       [ {...fix}, {...fix} ]           (used to flush the offline queue)
 *                -> {"type":"batch-ack","accepted":N}
 *   keep-alive  ping                              -> {"type":"pong"}
 *
 * Errors come back as {"type":"error", "code":"INVALID_LATITUDE", ...}.
 *
 * Rules from the backend:
 *   - Call POST start-journey BEFORE opening the socket (it creates the Redis
 *     tracking state user:gps:{dispatchId}).
 *   - gpsTimestamp is optional UTC ISO time; must not be >5 min in the future
 *     or >48 h old. Without it the server uses its own time.
 *   - After complete-journey the server refuses further GPS for that
 *     dispatch, and the app closes the socket.
 *
 * This class handles reconnect with backoff, a keep-alive ping, and an
 * offline queue: fixes taken while the socket is down are kept (with their
 * real gpsTimestamp) and flushed as one batch when it reconnects.
 */

import { getGpsWsUrl } from '../api/client';
import { gpsLog, gpsWarn } from '../utils/gpsLogger';

export interface GpsFix {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
  speed?: number | null;
  heading?: number | null;
  /** Epoch millis of the GPS fix (Location.timestamp). */
  timestamp?: number;
}

export interface GpsSocketIdentity {
  dispatchId: string;
  deviceId: string;
  vehicleId: string;
}

export type GpsSocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface GpsSocketError {
  code: string;
  message: string;
  raw?: unknown;
}

export interface GpsSocketCallbacks {
  onStatusChange?: (status: GpsSocketStatus) => void;
  /** Fired for every accepted fix (single ack, or each item of a batch-ack). */
  onAccepted?: (acceptedCount: number, raw: unknown) => void;
  onError?: (error: GpsSocketError) => void;
  /** Server refused GPS because the journey is already COMPLETED / ARRIVED. */
  onJourneyClosed?: (error: GpsSocketError) => void;
}

interface WireFix {
  dispatchId: string;
  deviceId: string;
  vehicleId?: string;
  latitude: number;
  longitude: number;
  accuracy: number;
  speed: number;
  heading: number;
  messageId: string;
  gpsTimestamp?: string;
}

const KEEP_ALIVE_MS = 25_000;
const RECONNECT_BASE_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;
const MAX_QUEUE = 500;
const MAX_BATCH = 50;
/** Backend rejects fixes older than 48 h; drop a bit earlier to be safe. */
const MAX_FIX_AGE_MS = 47 * 60 * 60 * 1000;

/** "2026-09-30T11:30:00Z" — UTC, no millis (matches the backend sample). */
function toGpsTimestamp(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function num(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * The GPS service only accepts ids made of letters, digits, '-', '_', '.', ':'
 * (first character a letter or digit, up to 128). A vehicle number such as
 * "TG 09 8908" has spaces, and the server rejects EVERY ping that carries it
 * (INVALID_VEHICLE_ID). Spaces become '-', other characters are dropped:
 * "TG 09 8908" -> "TG-09-8908". Returns '' when nothing usable is left.
 */
export function toWireId(value: string | null | undefined): string {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9_.:-]/g, '')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 128);
}

function looksLikeJourneyClosed(code: string, message: string): boolean {
  const text = `${code} ${message}`.toUpperCase();
  // Only a journey that is really finished — never "not started yet" style errors.
  return /COMPLETED|ARRIVED/.test(text);
}

export class GpsWebSocket {
  private ws: WebSocket | null = null;
  private status: GpsSocketStatus = 'idle';
  private closedByUser = false;
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private queue: WireFix[] = [];
  private seq = 0;

  readonly url: string;
  private readonly wireDeviceId: string;
  private readonly wireVehicleId: string;

  constructor(
    private readonly identity: GpsSocketIdentity,
    private readonly callbacks: GpsSocketCallbacks = {},
  ) {
    this.wireDeviceId = toWireId(identity.deviceId) || 'unknown-device';
    this.wireVehicleId = toWireId(identity.vehicleId);
    this.url = `${getGpsWsUrl()}/ws/gps/mobile/${encodeURIComponent(identity.dispatchId)}`;
    gpsLog('WS-INIT', {
      url: this.url,
      dispatchId: identity.dispatchId,
      deviceId: this.wireDeviceId,
      vehicleId: this.wireVehicleId || '(none)',
    });
  }

  getStatus(): GpsSocketStatus {
    return this.status;
  }

  getQueuedCount(): number {
    return this.queue.length;
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  /**
   * Send one GPS fix. Queued automatically if the socket isn't open yet.
   * Returns 'sent' (written to the open socket), 'queued' (held until reconnect)
   * or 'dropped' (socket permanently closed).
   */
  send(fix: GpsFix): 'sent' | 'queued' | 'dropped' {
    if (this.closedByUser) return 'dropped';

    const wire: WireFix = {
      dispatchId: this.identity.dispatchId,
      deviceId: this.wireDeviceId,
      // Optional on the server; left out when the vehicle number has no usable characters.
      ...(this.wireVehicleId ? { vehicleId: this.wireVehicleId } : {}),
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracy: num(fix.accuracy),
      speed: num(fix.speed),
      heading: num(fix.heading),
      messageId: `${this.wireDeviceId}-${Date.now()}-${++this.seq}`,
      ...(fix.timestamp ? { gpsTimestamp: toGpsTimestamp(fix.timestamp) } : {}),
    };

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const json = JSON.stringify(wire);
        this.ws.send(json);
        gpsLog('WS-SEND', { id: wire.messageId, bytes: json.length, payload: json });
        return 'sent';
      } catch (err) {
        gpsWarn('WS-SEND-FAILED (queueing)', { id: wire.messageId, err: String(err) });
      }
    }

    this.enqueue(wire);
    gpsLog('WS-QUEUED (socket not open)', {
      id: wire.messageId,
      socket: this.status,
      readyState: this.ws ? this.ws.readyState : 'none',
      queued: this.queue.length,
    });
    return 'queued';
  }

  /** Permanently close (journey completed / screen left). No reconnect. */
  close(): void {
    gpsLog('WS-CLOSE requested by app', { queuedUnsent: this.queue.length, status: this.status });
    this.closedByUser = true;
    this.clearTimers();
    if (this.ws) {
      try {
        this.ws.close(1000, 'client closed');
      } catch {
        // ignore
      }
      this.ws = null;
    }
    this.setStatus('closed');
  }

  // ── internals ───────────────────────────────────────────────────────────

  private setStatus(next: GpsSocketStatus) {
    if (this.status === next) return;
    gpsLog('WS-STATUS', { from: this.status, to: next });
    this.status = next;
    this.callbacks.onStatusChange?.(next);
  }

  private enqueue(wire: WireFix) {
    this.queue.push(wire);
    if (this.queue.length > MAX_QUEUE) {
      this.queue.splice(0, this.queue.length - MAX_QUEUE); // keep the newest
    }
  }

  private open() {
    if (this.closedByUser) return;
    this.clearTimers();

    this.setStatus(this.reconnectAttempt === 0 ? 'connecting' : 'reconnecting');
    gpsLog('WS-CONNECTING', { url: this.url, attempt: this.reconnectAttempt });

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch (err) {
      gpsWarn('WS-CREATE-FAILED', { url: this.url, err: String(err) });
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      gpsLog('WS-OPEN', { url: this.url, queuedToFlush: this.queue.length });
      this.reconnectAttempt = 0;
      this.setStatus('open');
      this.flushQueue();
      this.keepAliveTimer = setInterval(() => {
        if (this.ws === ws && ws.readyState === WebSocket.OPEN) {
          try {
            ws.send('ping');
            gpsLog('WS-KEEPALIVE ping sent');
          } catch {
            // the close handler will deal with it
          }
        }
      }, KEEP_ALIVE_MS);
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      this.handleMessage(event.data);
    };

    ws.onerror = (event) => {
      if (this.ws !== ws) return;
      gpsWarn('WS-ERROR', { message: (event as any)?.message ?? 'socket error (no detail - check server/port/cleartext)' });
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      gpsLog('WS-CLOSED', { code: event.code, reason: event.reason || '-', byApp: this.closedByUser, queued: this.queue.length });
      this.ws = null;
      this.clearTimers();
      if (this.closedByUser) {
        this.setStatus('closed');
        return;
      }
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect() {
    if (this.closedByUser) return;
    this.setStatus('reconnecting');
    const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** this.reconnectAttempt);
    this.reconnectAttempt += 1;
    gpsWarn('WS-RECONNECT scheduled', { inMs: delay, attempt: this.reconnectAttempt, queued: this.queue.length });
    this.reconnectTimer = setTimeout(() => this.open(), delay);
  }

  private flushQueue() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || this.queue.length === 0) return;

    const cutoff = Date.now() - MAX_FIX_AGE_MS;
    const totalQueued = this.queue.length;
    const pending = this.queue.filter((f) => !f.gpsTimestamp || Date.parse(f.gpsTimestamp) >= cutoff);
    this.queue = [];
    gpsLog('WS-FLUSHING offline queue', { queued: totalQueued, sending: pending.length, tooOldDropped: totalQueued - pending.length });

    for (let i = 0; i < pending.length; i += MAX_BATCH) {
      const chunk = pending.slice(i, i + MAX_BATCH);
      try {
        this.ws.send(JSON.stringify(chunk.length === 1 ? chunk[0] : chunk));
      } catch (err) {
        gpsWarn('WS-FLUSH-FAILED (re-queueing)', { err: String(err) });
        this.queue = pending.slice(i).concat(this.queue);
        return;
      }
    }
    gpsLog('WS-FLUSHED offline queue sent', { fixes: pending.length });
  }

  private handleMessage(data: unknown) {
    const text = typeof data === 'string' ? data : String(data);

    let msg: any;
    try {
      msg = JSON.parse(text);
    } catch {
      if (text.trim().toLowerCase() === 'pong') {
        gpsLog('WS-KEEPALIVE pong received');
        return;
      }
      gpsLog('WS-RECV non-JSON', { text });
      return;
    }

    switch (msg?.type) {
      case 'pong':
        gpsLog('WS-KEEPALIVE pong received');
        return;
      case 'connected':
        // Greeting the server sends right after the socket opens.
        gpsLog('WS-HELLO server ready', { raw: text });
        return;
      case 'ack':
        if (msg.success === false) {
          gpsWarn('WS-ACK success=false', { raw: text });
          this.reportError(msg);
        } else {
          gpsLog('WS-ACK server accepted ping', { raw: text });
          this.callbacks.onAccepted?.(1, msg);
        }
        return;
      case 'batch-ack':
        gpsLog('WS-BATCH-ACK', { accepted: Number(msg.accepted) || 0, raw: text });
        this.callbacks.onAccepted?.(Number(msg.accepted) || 0, msg);
        return;
      case 'error':
        gpsWarn('WS-RECV error from server', { raw: text });
        this.reportError(msg);
        return;
      default:
        gpsLog('WS-RECV unknown message', { raw: text });
    }
  }

  private reportError(msg: any) {
    const error: GpsSocketError = {
      code: String(msg?.code ?? msg?.errorCode ?? 'ERROR'),
      message: String(msg?.message ?? msg?.error ?? 'GPS server rejected the location.'),
      raw: msg,
    };
    gpsWarn('WS-SERVER-ERROR', { code: error.code, message: error.message });

    if (looksLikeJourneyClosed(error.code, error.message)) {
      this.callbacks.onJourneyClosed?.(error);
      return;
    }
    this.callbacks.onError?.(error);
  }

  private clearTimers() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.keepAliveTimer) {
      clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = null;
    }
  }
}

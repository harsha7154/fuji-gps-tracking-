/**
 * Live GPS READ socket — standalone GPS service (port 8070, Redis-backed).
 *
 *   URL:  {gpsWs}/ws/gps/live/{dispatchId}[?token=...]
 *         e.g. ws://13.233.171.171:8070/ws/gps/live/DSP-748383
 *
 * This is the same stream the web Dispatch Tracker reads (dispatch-tracker.jsp):
 *
 *   driver app --/ws/gps/mobile/{dispatchId}--> GPS service --> Redis
 *   this socket <--/ws/gps/live/{dispatchId}--- GPS service
 *
 * Messages the server SENDS:
 *   {"type":"snapshot","found":true,"location":{latitude,longitude,...},"journeyStatus":"..."}
 *        once after connecting: the last position stored in Redis
 *   {"type":"gps","latitude":..,"longitude":..,"speed":..,"heading":..,"accuracy":..,"gpsTimestamp":..}
 *        every position the GPS service stores
 *   {"type":"journey","journeyStatus":"ARRIVED" | "COMPLETED" | ...}
 *
 * The app sends only the keep-alive text "ping".
 *
 * Optional: EXPO_PUBLIC_GPS_LIVE_READ_TOKEN — needed only when GPS_LIVE_READ_TOKEN
 * is set in the GPS service (same value as gps.live.read.token on the web side).
 */

import { getGpsWsUrl } from '../api/client';

export interface LivePosition {
  lat: number;
  lng: number;
  /** km/h as stored by the GPS service; 0 when unknown. */
  speed: number;
  /** Degrees; 0 when unknown. */
  heading: number;
  /** Meters; 0 when unknown. */
  accuracy: number;
  /** Epoch millis of the GPS fix; 0 when the server did not send one. */
  ts: number;
}

export type LiveSocketStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface LiveSocketCallbacks {
  onStatusChange?: (status: LiveSocketStatus) => void;
  /** A truck position from the GPS service. fromSnapshot = the stored last position. */
  onPosition?: (position: LivePosition, fromSnapshot: boolean) => void;
  /** The GPS service reports the journey as arrived / completed. */
  onArrived?: () => void;
}

const KEEP_ALIVE_MS = 25_000;
/** No message at all for this long = dead connection, reconnect. */
const SILENCE_MS = 75_000;
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 30_000;
/**
 * The socket never opened after this many tries: the GPS service on the server
 * is most likely a build without /ws/gps/live (its /health then has no
 * "liveEndpoint" field). Keep trying, but only rarely, so the log is not
 * flooded; it connects by itself once the service is updated.
 */
const UNAVAILABLE_AFTER_FAILURES = 3;
const UNAVAILABLE_RETRY_MS = 5 * 60_000;

function toMillis(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Same field names as the web tracker's readPosition(). */
export function readLivePosition(source: any): LivePosition | null {
  if (!source || typeof source !== 'object') return null;
  const lat = parseFloat(source.latitude);
  const lng = parseFloat(source.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const heading = parseFloat(source.heading);
  return {
    lat,
    lng,
    speed: parseFloat(source.speed) || 0,
    heading: Number.isFinite(heading) && heading > 0 ? heading : 0,
    accuracy: parseFloat(source.accuracy) || 0,
    ts: toMillis(source.gpsTimestamp) || toMillis(source.timestamp) || toMillis(source.lastUpdated),
  };
}

function isArrivedStatus(status: unknown): boolean {
  const s = String(status ?? '').toUpperCase();
  return s === 'ARRIVED' || s === 'ARRIVED_AT_SITE' || s === 'COMPLETED';
}

export class GpsLiveSocket {
  private ws: WebSocket | null = null;
  private status: LiveSocketStatus = 'idle';
  private closedByUser = false;
  private reconnectDelay = RECONNECT_BASE_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  private lastMessageAt = 0;
  private everOpened = false;
  private failedOpens = 0;

  /** Without the token (safe to log). */
  readonly url: string;
  private readonly fullUrl: string;

  constructor(
    dispatchId: string,
    private readonly callbacks: LiveSocketCallbacks = {},
  ) {
    this.url = `${getGpsWsUrl()}/ws/gps/live/${encodeURIComponent(dispatchId)}`;
    const token = (process.env.EXPO_PUBLIC_GPS_LIVE_READ_TOKEN ?? '').trim();
    this.fullUrl = token ? `${this.url}?token=${encodeURIComponent(token)}` : this.url;
  }

  getStatus(): LiveSocketStatus {
    return this.status;
  }

  connect(): void {
    this.closedByUser = false;
    this.open();
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.stopKeepAlive();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        // already closed
      }
    }
    this.setStatus('closed');
  }

  private setStatus(status: LiveSocketStatus): void {
    if (this.status === status) return;
    this.status = status;
    this.callbacks.onStatusChange?.(status);
  }

  private open(): void {
    if (this.closedByUser || this.ws) return;
    this.setStatus(this.status === 'idle' || this.status === 'closed' ? 'connecting' : 'reconnecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.fullUrl);
    } catch (err) {
      console.warn('[GPS-LIVE] cannot open', this.url, err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.everOpened = true;
      this.failedOpens = 0;
      this.lastMessageAt = Date.now();
      console.log('[GPS-LIVE] connected to', this.url);
      this.setStatus('open');
      this.startKeepAlive();
    };

    ws.onmessage = (event) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = Date.now();
      this.handleMessage(event.data);
    };

    ws.onerror = () => {
      // onclose follows and reconnects
    };

    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopKeepAlive();
      if (this.closedByUser) return;
      if (this.status !== 'open') this.failedOpens += 1;
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.closedByUser) return;
    this.setStatus('reconnecting');
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);

    const unavailable = !this.everOpened && this.failedOpens >= UNAVAILABLE_AFTER_FAILURES;
    if (unavailable && this.failedOpens === UNAVAILABLE_AFTER_FAILURES) {
      console.warn(
        '[GPS-LIVE]',
        this.url,
        'cannot be opened. The GPS service on the server probably has no /ws/gps/live endpoint (old build).',
        'Trying again every 5 minutes.',
      );
    }
    const delay = unavailable ? UNAVAILABLE_RETRY_MS : this.reconnectDelay;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.open();
    }, delay);
    this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
  }

  private startKeepAlive(): void {
    this.stopKeepAlive();
    this.keepAliveTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== 1) return;
      if (Date.now() - this.lastMessageAt > SILENCE_MS) {
        try {
          ws.close();
        } catch {
          // onclose reconnects
        }
        return;
      }
      try {
        ws.send('ping');
      } catch {
        // onclose reconnects
      }
    }, KEEP_ALIVE_MS);
  }

  private stopKeepAlive(): void {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let message: any;
    try {
      message = JSON.parse(data);
    } catch {
      return; // "pong" etc.
    }
    if (!message || typeof message !== 'object') return;

    if (message.type === 'snapshot') {
      const location = message.location;
      // The entry Liferay stores when the dispatch is created holds the plant
      // position without a device: not a GPS position of the truck. "user:gps"
      // is the driver's position stored by Start Journey, before the first ping.
      if (message.found && location && (location.deviceId || location.vehicleId || location.dispatchId || location.source === 'user:gps')) {
        const p = readLivePosition(location);
        if (p) this.callbacks.onPosition?.(p, true);
      }
      if (isArrivedStatus(message.journeyStatus)) this.callbacks.onArrived?.();
    } else if (message.type === 'journey' || message.arrived === true) {
      if (message.arrived === true || isArrivedStatus(message.journeyStatus)) this.callbacks.onArrived?.();
    } else {
      // Any other message with coordinates is a position ("gps", or a build that sends no
      // type) — same rule as the web tracker, which accepts every message with lat/lng.
      const p = readLivePosition(message);
      if (p) this.callbacks.onPosition?.(p, false);
      if (isArrivedStatus(message.journeyStatus)) this.callbacks.onArrived?.();
    }
  }
}

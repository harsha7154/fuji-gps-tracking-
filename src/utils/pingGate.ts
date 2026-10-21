/**
 * GPS ping "gate" — decides whether a ping is worth sending to the backend
 * (Java GPS Gateway -> Redis).
 *
 * Kept as pure functions (no React, no expo-location, no fetch) so the rules
 * can be unit-tested and tuned in one place.
 *
 * Rules:
 *  1. The screen ticks every PING_INTERVAL_MS (10 s).
 *  2. On each tick the current position is compared with the LAST ping that
 *     was successfully sent.
 *  3. If it is the "same" position (moved < MIN_MOVE_METERS) -> skip, nothing
 *     goes to Redis.
 *  4. Safety net: if nothing has been sent for HEARTBEAT_MS, send once anyway
 *     so a parked vehicle does not look "offline" and so a stop right at the
 *     arrival boundary can never get stuck. Set HEARTBEAT_MS = 0 to disable.
 *
 * Why metres instead of comparing raw degrees:
 *  ~0.0009° of LATITUDE  ≈ 100 m everywhere on Earth.
 *  ~0.0009° of LONGITUDE ≈ 100 m only at the equator (the table used
 *  lat 0.0000). It shrinks with cos(latitude): at Hyderabad (~17.4°N)
 *  100 m east is ≈ 0.00094°. Haversine handles this correctly for any place.
 *
 * Why a small tolerance instead of exact equality:
 *  A phone that is standing perfectly still still reports lat/lng that wobble
 *  by a few metres between fixes, so "exactly equal" would almost never be
 *  true and every ping would be sent anyway.
 */

/** How often the app evaluates whether to ping. */
export const PING_INTERVAL_MS = 10_000;

/** Movement smaller than this (metres) since the last SENT ping counts as "same position". */
export const MIN_MOVE_METERS = 5;

/** Max silence while stationary before one keep-alive ping is forced. 0 = never. */
export const HEARTBEAT_MS = 60_000;

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** The last ping that the backend actually accepted. */
export interface LastSentPing extends LatLng {
  /** Date.now() at the moment the ping was accepted. */
  sentAt: number;
}

export type PingDecision =
  | { send: true; reason: 'first' | 'moved' | 'heartbeat'; movedMeters: number }
  | { send: false; reason: 'unchanged'; movedMeters: number };

/** Great-circle distance in metres between two coordinates. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000; // Earth radius, metres
  const toRad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * toRad;
  const dLon = (b.longitude - a.longitude) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Compare the current position with the last ping that was successfully sent.
 *
 * `lastSent` must only ever be updated after the server ACCEPTED a ping. That
 * way a failed request (bad network) leaves `lastSent` untouched and the next
 * tick automatically tries again.
 */
export function decidePing(
  current: LatLng,
  lastSent: LastSentPing | null,
  now: number,
  opts: { minMoveMeters?: number; heartbeatMs?: number } = {}
): PingDecision {
  const minMove = opts.minMoveMeters ?? MIN_MOVE_METERS;
  const heartbeat = opts.heartbeatMs ?? HEARTBEAT_MS;

  // Nothing sent yet for this trip -> always send.
  if (!lastSent) {
    return { send: true, reason: 'first', movedMeters: 0 };
  }

  const movedMeters = distanceMeters(lastSent, current);

  if (movedMeters >= minMove) {
    return { send: true, reason: 'moved', movedMeters };
  }

  if (heartbeat > 0 && now - lastSent.sentAt >= heartbeat) {
    return { send: true, reason: 'heartbeat', movedMeters };
  }

  return { send: false, reason: 'unchanged', movedMeters };
}

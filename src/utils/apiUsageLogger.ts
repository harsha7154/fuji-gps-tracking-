/**
 * API usage logger — shows how often the app calls Google, and how fast.
 *
 * Everything is printed with ONE greppable tag:  [API-USAGE]
 *
 *   adb logcat -s ReactNativeJS:V | grep "API-USAGE"
 *   (PowerShell)  adb logcat -s ReactNativeJS:V | Select-String "API-USAGE"
 *
 * What you will see:
 *   ROUTES-CALL   a request really sent to Google Routes API (this is BILLED,
 *                 even when Google answers with an error). Shows why it was
 *                 sent, the HTTP status, how long Google took, the gap since
 *                 the previous call, and counts for the last 1 min / 1 hour /
 *                 whole session.
 *   ROUTES-CACHE  answered from memory — NO request, NO cost.
 *   ROUTES-SKIP   not sent because Google rejected the key / quota is hit
 *                 recently — NO request, NO cost.
 *   MAP-LOAD      a native Google map was created (Maps SDK for Android —
 *                 not a Routes API call).
 *   LIVE-POSITION a live truck position reached the map. Compare this count
 *                 with ROUTES-CALL: positions should be MANY, route calls FEW.
 *   SUMMARY       totals, printed after every Routes call.
 *
 * Set API_USAGE_LOGGING_ENABLED = false to silence everything.
 */

export const API_USAGE_LOGGING_ENABLED = true;

const HOUR_MS = 60 * 60_000;
const MINUTE_MS = 60_000;

const routesCallTimes: number[] = [];
let routesCalls = 0;
let routesErrors = 0;
let routesCacheHits = 0;
let routesSkipped = 0;
let mapLoads = 0;
let livePositions = 0;
let lastRoutesCallAt = 0;
let lastLivePositionAt = 0;
const sessionStartedAt = Date.now();

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function stamp(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function out(line: string, warn = false): void {
  if (!API_USAGE_LOGGING_ENABLED) return;
  const text = `[API-USAGE] ${stamp()} ${line}`;
  if (warn) console.warn(text);
  else console.log(text);
}

function countWithin(windowMs: number, now: number): number {
  let n = 0;
  for (let i = routesCallTimes.length - 1; i >= 0; i--) {
    if (now - routesCallTimes[i] <= windowMs) n++;
    else break;
  }
  return n;
}

export interface RoutesCallInfo {
  /** Why the app asked for a route (init-remaining, reroute-remaining, ...). */
  reason: string;
  /** Number of via points in the request. */
  via: number;
  /** HTTP status; 0 when no answer came (timeout / no internet). */
  status: number;
  ok: boolean;
  /** How long Google took to answer, ms. */
  tookMs: number;
  /** Short error text, when the call failed. */
  error?: string;
}

/** Call once for every request that was REALLY sent to the Routes API. */
export function logRoutesCall(info: RoutesCallInfo): void {
  const now = Date.now();
  routesCalls++;
  if (!info.ok) routesErrors++;
  routesCallTimes.push(now);
  if (routesCallTimes.length > 2000) routesCallTimes.splice(0, routesCallTimes.length - 2000);

  const gap = lastRoutesCallAt ? secs(now - lastRoutesCallAt) : 'first';
  lastRoutesCallAt = now;

  out(
    `ROUTES-CALL #${routesCalls} reason=${info.reason} via=${info.via} status=${info.status} ` +
      `took=${info.tookMs}ms sinceLastCall=${gap} last1min=${countWithin(MINUTE_MS, now)} ` +
      `last1hr=${countWithin(HOUR_MS, now)}${info.error ? ` error="${info.error}"` : ''}`,
    !info.ok
  );
  logUsageSummary();
}

/** Route answered from memory (no Google request). */
export function logRoutesCacheHit(reason: string): void {
  routesCacheHits++;
  out(`ROUTES-CACHE reason=${reason} (served from memory, no request) cacheHits=${routesCacheHits}`);
}

/** Request not sent because Google rejected the key / quota recently. */
export function logRoutesSkipped(reason: string, why: string, waitMs: number): void {
  routesSkipped++;
  out(`ROUTES-SKIP reason=${reason} why="${why}" retryIn=${secs(waitMs)} skipped=${routesSkipped}`, true);
}

/** A native map view was created. */
export function logMapLoad(where: string): void {
  mapLoads++;
  out(`MAP-LOAD #${mapLoads} where=${where}`);
}

/** A live truck position reached the map component. */
export function logLivePosition(lat: number, lng: number): void {
  const now = Date.now();
  livePositions++;
  const gap = lastLivePositionAt ? secs(now - lastLivePositionAt) : 'first';
  lastLivePositionAt = now;
  out(
    `LIVE-POSITION #${livePositions} lat=${lat.toFixed(5)} lng=${lng.toFixed(5)} sinceLast=${gap} ` +
      `(map only — no Google request for this)`
  );
}

export function logUsageSummary(): void {
  const now = Date.now();
  const minutes = Math.max((now - sessionStartedAt) / MINUTE_MS, 1 / 60);
  out(
    `SUMMARY routesCalls=${routesCalls} (errors=${routesErrors}) cacheHits=${routesCacheHits} ` +
      `skipped=${routesSkipped} mapLoads=${mapLoads} livePositions=${livePositions} ` +
      `sessionAge=${minutes.toFixed(1)}min avgRoutesCalls/hr=${((routesCalls / minutes) * 60).toFixed(1)}`
  );
}

export function getApiUsage() {
  return { routesCalls, routesErrors, routesCacheHits, routesSkipped, mapLoads, livePositions };
}

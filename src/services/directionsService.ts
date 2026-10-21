import { Platform } from 'react-native';

import { fetchWithTimeout, getGoogleMapsApiKey } from '../api/client';
import { logRoutesCacheHit, logRoutesCall, logRoutesSkipped } from '../utils/apiUsageLogger';
import { isValidPt, pathLength, Pt } from '../utils/routeGeometry';

const REQUEST_TIMEOUT_MS = 10000;
const ROUTES_API_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes';

// Must match android.package / ios.bundleIdentifier in app.json.
const ANDROID_PACKAGE = 'com.fujisilvertech.mobile';
const IOS_BUNDLE_ID = 'com.fujisilvertech.mobile';

/**
 * WHY THE ROUTES API RETURNED 100 % ERRORS
 * ----------------------------------------
 * The same key is used for the map (Maps SDK for Android — works, 0 % errors)
 * and for this REST call (Routes API — 100 % errors, ~27 ms). If that key is
 * restricted to "Android apps" in Google Cloud, the Maps SDK proves who it is
 * automatically (package name + SHA-1), but a plain fetch() from JavaScript
 * does NOT, so Google rejects every request at once with 403
 * ("Requests from this Android client application <empty> are blocked").
 *
 * Two fixes (pick one — see README_CHANGES.md):
 *   A) Use a SEPARATE key for Routes API (API restriction = Routes API only,
 *      application restriction = None) -> EXPO_PUBLIC_GOOGLE_ROUTES_API_KEY.
 *   B) Keep one key and send the app identity ourselves: set
 *      EXPO_PUBLIC_ANDROID_CERT_SHA1 (the SHA-1 of the key that signs the
 *      APK) and these headers are added automatically.
 */
function googleAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (Platform.OS === 'android') {
    const sha1 = (process.env.EXPO_PUBLIC_ANDROID_CERT_SHA1 ?? '').replace(/[:\s]/g, '').toUpperCase();
    if (sha1) {
      headers['X-Android-Package'] = ANDROID_PACKAGE;
      headers['X-Android-Cert'] = sha1;
    }
  } else if (Platform.OS === 'ios') {
    headers['X-Ios-Bundle-Identifier'] = IOS_BUNDLE_ID;
  }
  return headers;
}

/** Key for the Routes API: a dedicated key when set, otherwise the maps key. */
function getRoutesApiKey(): string {
  return (process.env.EXPO_PUBLIC_GOOGLE_ROUTES_API_KEY ?? '').trim() || getGoogleMapsApiKey();
}

/** Short, readable reason out of a Google error body. */
function googleErrorText(data: any): string {
  const e = data?.error;
  if (!e) return '';
  const detail = Array.isArray(e.details) ? e.details.find((d: any) => d?.reason)?.reason : '';
  return [e.status, detail, String(e.message ?? '').slice(0, 140)].filter(Boolean).join(' | ');
}

/**
 * Decodes a Google-encoded polyline string into an array of [lat, lng]
 * pairs. Routes API's `polyline.encodedPolyline` uses the same standard
 * algorithm as the legacy Directions API, so this is unchanged.
 * https://developers.google.com/maps/documentation/utilities/polylinealgorithm
 */
export function decodePolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let result = 1;
    let shift = 0;
    let b: number;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lat += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    result = 1;
    shift = 0;
    do {
      b = encoded.charCodeAt(index++) - 63 - 1;
      result += b << shift;
      shift += 5;
    } while (b >= 0x1f);
    lng += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

    points.push([lat * 1e-5, lng * 1e-5]);
  }

  return points;
}

export interface DirectionsRouteResult {
  coordinates: [number, number][]; // [lat, lng] path, live -> destination
  distanceMeters: number;
  durationSeconds: number;
  distanceLabel: string;
  durationLabel: string;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `${hrs} hr ${rem} min`;
}

/**
 * Fetches a driving route from Google's Routes API (computeRoutes) —
 * live location -> destination.
 *
 * SWITCHED from the legacy Directions API REST endpoint
 * (maps.googleapis.com/maps/api/directions/json) to the Routes API
 * (routes.googleapis.com/directions/v2:computeRoutes) because Routes
 * API is the product confirmed working against this Google Cloud
 * project/key (verified via a standalone HTML test using
 * google.maps.importLibrary("routes")). The legacy Directions API is a
 * SEPARATE product in Google Cloud Console's API Library — enabling
 * one does NOT enable the other, which is why the app previously fell
 * back to a straight line while the HTML test worked fine.
 *
 * NOTE on API usage / cost: still a metered call — same throttling
 * contract as before, enforced by the caller (GoogleRouteMap), not
 * this function. Do not remove that throttling.
 */
export async function fetchDirectionsRoute(
  origin: [number, number],
  destination: [number, number]
): Promise<DirectionsRouteResult | null> {
  const apiKey = getRoutesApiKey();
  if (!apiKey) {
    console.warn('[directionsService] No Google Maps API key configured (EXPO_PUBLIC_GOOGLE_MAPS_API_KEY) — skipping route fetch.');
    return null;
  }
  if (!origin || !destination || origin[0] === 0 || destination[0] === 0) {
    return null;
  }

  const requestBody = {
    origin: { location: { latLng: { latitude: origin[0], longitude: origin[1] } } },
    destination: { location: { latLng: { latitude: destination[0], longitude: destination[1] } } },
    travelMode: 'DRIVE',
    routingPreference: 'TRAFFIC_AWARE', // enables traffic-aware duration, like departure_time=now did before
    // HIGH_QUALITY (not OVERVIEW) — OVERVIEW deliberately returns a
    // simplified polyline with far fewer points ("lower request latency
    // than HIGH_QUALITY" per Google's Routes API docs), which is what was
    // causing the near-straight-line look instead of a road-snapped path.
    polylineQuality: 'HIGH_QUALITY',
  };

  const startedAt = Date.now();
  try {
    console.log('[ROUTES-API] POST', ROUTES_API_URL, JSON.stringify(requestBody));
    const response = await fetchWithTimeout(ROUTES_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          ...googleAuthHeaders(),
          // Field mask is REQUIRED by Routes API — requests without it are
          // rejected outright. Only request the fields this app actually uses.
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify(requestBody),
      }, REQUEST_TIMEOUT_MS, 'Request timed out');

    const data = await response.json();
    console.log('[ROUTES-API] status:', response.status, ' routes:', data.routes?.length ?? 0);
    logRoutesCall({
      reason: 'legacy-fetchDirectionsRoute',
      via: 0,
      status: response.status,
      ok: response.ok && !!data.routes?.length,
      tookMs: Date.now() - startedAt,
      error: googleErrorText(data),
    });

    if (!response.ok || !data.routes || data.routes.length === 0) {
      console.warn('[ROUTES-API] no usable route in response:', response.status, JSON.stringify(data.error ?? data));
      return null;
    }

    const route = data.routes[0];
    const coordinates = decodePolyline(route.polyline?.encodedPolyline ?? '');
    const distanceMeters: number = route.distanceMeters ?? 0;
    // Routes API returns duration as a string like "1234s", not an object
    const durationSeconds: number = route.duration ? parseInt(String(route.duration).replace('s', ''), 10) : 0;

    return {
      coordinates,
      distanceMeters,
      durationSeconds,
      distanceLabel: formatDistance(distanceMeters),
      durationLabel: formatDuration(durationSeconds),
    };
  } catch (err) {
    console.warn('[ROUTES-API] fetchDirectionsRoute failed:', err);
    logRoutesCall({ reason: 'legacy-fetchDirectionsRoute', via: 0, status: 0, ok: false, tookMs: Date.now() - startedAt, error: String(err) });
    return null;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// Road routes for the tracking map (same Routes API, with optional via points)
// ─────────────────────────────────────────────────────────────────────────────

export interface RoadRoute {
  /** Road-following path, origin -> destination. */
  path: Pt[];
  distanceM: number;
  durationMs: number;
}

/** Routes API allows 25 intermediate points per request. */
const MAX_VIA_POINTS = 23;

// ── Quota protection ─────────────────────────────────────────────────────────
const ROUTE_CACHE_MS = 10 * 60_000; // truck/plant -> site: traffic changes, keep 10 minutes
const ROUTE_CACHE_VIA_MS = 6 * 60 * 60_000; // route through history points: road geometry only
const ROUTE_CACHE_MAX = 60;
const QUOTA_BLOCK_MS = 10 * 60_000; // after "quota exceeded" / "key not allowed"
const FAILURE_BLOCK_MS = 60_000; // after any other failure of the SAME route: do not retry it for 1 minute

const routeCache = new Map<string, { at: number; route: RoadRoute }>();
const failedRoutes = new Map<string, number>(); // cacheKey -> time of the last failure
let blockedUntil = 0;
let roadRouteProblem: string | null = null;

/** ~1 m precision: the same place gives the same key. */
const keyOf = (p: Pt) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
const routeCacheKey = (origin: Pt, destination: Pt, via: Pt[]) =>
  `${keyOf(origin)}>${via.map(keyOf).join('>')}>${keyOf(destination)}`;

/** Why the last road route could not be fetched (shown on the map); null = no problem. */
export function getRoadRouteProblem(): string | null {
  return roadRouteProblem;
}

const toWaypoint = (p: Pt, via = false) => ({
  location: { latLng: { latitude: p.lat, longitude: p.lng } },
  ...(via ? { via: true } : {}),
});

/**
 * Road route origin -> (via points) -> destination.
 * Resolves null when Google could not give one; never throws.
 *
 * Via points make the route pass through them without stopping — used to draw
 * the travelled (gray) line along real roads through the stored GPS pings
 * instead of straight lines between pings.
 */
export async function fetchRoadRoute(
  origin: Pt,
  destination: Pt,
  via: Pt[] = [],
  reason = 'unspecified'
): Promise<RoadRoute | null> {
  const apiKey = getRoutesApiKey();
  if (!apiKey) {
    console.warn('[directionsService] No Google Maps API key configured — skipping route fetch.');
    roadRouteProblem = 'Google Maps API key is not configured';
    return null;
  }
  if (!isValidPt(origin) || !isValidPt(destination)) return null;

  // Every request counts against the Google project's daily quota:
  //  - the same route is answered from memory (opening the page again, hot reload);
  //  - after "quota exceeded" / "key not allowed" no request is sent for a while.
  const cacheKey = routeCacheKey(origin, destination, via);
  const cached = routeCache.get(cacheKey);
  if (cached && Date.now() - cached.at < (via.length ? ROUTE_CACHE_VIA_MS : ROUTE_CACHE_MS)) {
    logRoutesCacheHit(reason);
    return cached.route;
  }
  if (Date.now() < blockedUntil) {
    logRoutesSkipped(reason, roadRouteProblem ?? 'blocked after a Google error', blockedUntil - Date.now());
    return null;
  }
  // The same route just failed: asking again at once only costs money.
  const failedAt = failedRoutes.get(cacheKey);
  if (failedAt && Date.now() - failedAt < FAILURE_BLOCK_MS) {
    logRoutesSkipped(reason, 'same route failed a moment ago', FAILURE_BLOCK_MS - (Date.now() - failedAt));
    return null;
  }

  const requestBody: Record<string, unknown> = {
    origin: toWaypoint(origin),
    destination: toWaypoint(destination),
    travelMode: 'DRIVE',
    // Traffic only matters for the live "remaining" route; a route through
    // history points just needs the road geometry.
    routingPreference: via.length ? 'TRAFFIC_UNAWARE' : 'TRAFFIC_AWARE',
    polylineQuality: 'HIGH_QUALITY',
  };
  if (via.length) {
    requestBody.intermediates = via.filter(isValidPt).slice(0, MAX_VIA_POINTS + 2).map((p) => toWaypoint(p, true));
  }

  const startedAt = Date.now();
  try {
    const response = await fetchWithTimeout(ROUTES_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          ...googleAuthHeaders(),
          'X-Goog-FieldMask': 'routes.duration,routes.distanceMeters,routes.polyline.encodedPolyline',
        },
        body: JSON.stringify(requestBody),
      }, REQUEST_TIMEOUT_MS, 'Request timed out');
    const data = await response.json();
    const usable = response.ok && !!data.routes && data.routes.length > 0;
    logRoutesCall({
      reason,
      via: via.length,
      status: response.status,
      ok: usable,
      tookMs: Date.now() - startedAt,
      error: usable ? undefined : googleErrorText(data) || 'no route in response',
    });
    if (!usable) {
      failedRoutes.set(cacheKey, Date.now());
      console.warn('[ROUTES-API] no usable road route:', response.status, JSON.stringify(data.error ?? data).slice(0, 300));
      if (response.status === 429) {
        roadRouteProblem = 'Google Routes API daily limit reached';
        blockedUntil = Date.now() + QUOTA_BLOCK_MS;
      } else if (response.status === 401 || response.status === 403) {
        roadRouteProblem = `Google rejected the key (${response.status}): ${googleErrorText(data) || 'not allowed to use the Routes API'}`.slice(0, 160);
        blockedUntil = Date.now() + QUOTA_BLOCK_MS;
      } else if (!response.ok) {
        roadRouteProblem = `Google Routes API error ${response.status}`;
      } else {
        roadRouteProblem = 'Google found no road route between these points';
      }
      return null;
    }

    const route = data.routes[0];
    const path = decodePolyline(route.polyline?.encodedPolyline ?? '')
      .map(([lat, lng]) => ({ lat, lng }))
      .filter(isValidPt);
    if (path.length < 2) return null;

    const durationSeconds = route.duration ? parseInt(String(route.duration).replace('s', ''), 10) : 0;
    const result: RoadRoute = {
      path,
      distanceM: route.distanceMeters ?? pathLength(path),
      durationMs: (Number.isFinite(durationSeconds) ? durationSeconds : 0) * 1000,
    };
    roadRouteProblem = null;
    if (routeCache.size >= ROUTE_CACHE_MAX) {
      const oldest = routeCache.keys().next().value;
      if (oldest !== undefined) routeCache.delete(oldest);
    }
    routeCache.set(cacheKey, { at: Date.now(), route: result });
    return result;
  } catch (err) {
    console.warn('[ROUTES-API] fetchRoadRoute failed:', err);
    logRoutesCall({ reason, via: via.length, status: 0, ok: false, tookMs: Date.now() - startedAt, error: String(err) });
    failedRoutes.set(cacheKey, Date.now());
    roadRouteProblem = 'Could not reach Google (check the internet connection)';
    return null;
  }
}

/**
 * Road path through many points (25 per request, one request after another).
 * A chunk Google cannot route keeps its own points, so the line is never lost.
 */
export async function fetchRoadThrough(
  points: Pt[],
  computeRoad: (origin: Pt, destination: Pt, via: Pt[], reason?: string) => Promise<RoadRoute | null> = fetchRoadRoute
): Promise<Pt[]> {
  if (points.length < 2) return points.slice();
  let path: Pt[] = [];
  for (let i = 0; i < points.length - 1; i += MAX_VIA_POINTS + 1) {
    const chunk = points.slice(i, i + MAX_VIA_POINTS + 2);
    if (chunk.length < 2) break;
    const route = await computeRoad(chunk[0], chunk[chunk.length - 1], chunk.slice(1, -1), 'through-points');
    path = path.concat(route ? route.path : chunk);
  }
  return path;
}

export function formatRouteDistance(meters: number): string {
  return formatDistance(meters);
}

export function formatRouteDuration(ms: number): string {
  return formatDuration(ms / 1000);
}

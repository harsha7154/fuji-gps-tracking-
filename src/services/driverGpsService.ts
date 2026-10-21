/**
 * Driver journey REST API (Liferay /o/material-dispatch-rest) + GPS service health.
 *
 * Matches the "Anganwadi GPS - WebSocket + Redis APIs" Postman collection,
 * folder "2. Mobile journey". Every {{variable}} from that collection is
 * filled at runtime — nothing is hardcoded:
 *
 *   {{driverUserId}}   logged-in user's Liferay id               (user.id)
 *   {{dispatchId}}     dispatch.dispatchID, e.g. "DSP-748383"    (WebSocket URL, tracking)
 *   {{objectEntryId}}  dispatch.MaterialDispatchId, e.g. 41710   (detail, start/complete)
 *   {{deviceId}}       this phone's ANDROID_ID / iOS IDFV        (utils/deviceId.ts)
 *   {{vehicleId}}      dispatch.vehicleNumber                    (WebSocket GPS message)
 *   liveGPS            current phone location "lat,lng"          (start/complete)
 *
 * Endpoints:
 *   GET  {liferay}/o/material-dispatch-rest/driver/active-dispatch?userId=
 *   GET  {liferay}/o/material-dispatch-rest/dispatches?userId=&page=&pageSize=   (driverDashboardService)
 *   GET  {liferay}/o/material-dispatch-rest/dispatch/{objectEntryId}?userId=
 *   POST {liferay}/o/material-dispatch-rest/start-journey?objectEntryId=&deviceID=&liveGPS=
 *   POST {liferay}/o/material-dispatch-rest/complete-journey?objectEntryId=&deviceID=&liveGPS=
 *   GET  {liferay}/o/gps/live?dispatchId=           (Redis live position + journey status)
 *   GET  {gpsHttp}/health                           (standalone GPS service, port 8070)
 *
 * Live GPS itself is sent over the WebSocket — see gpsWebSocketService.ts.
 */

import { fetchWithTimeout, getBaseUrl, getGpsHttpUrl } from '../api/client';
import type { DispatchItem, DispatchPingHistoryItem } from '../types/driverDashboard';
import { normalizeDispatch, driverDashboardService } from './driverDashboardService';
import { fetchCached, invalidateJourneyData, peekQuery, qk, queryClient } from '../query/queryClient';

const REQUEST_TIMEOUT_MS = 15000;
const DISPATCH_REST = '/o/material-dispatch-rest';

export interface ActiveDispatchResponse extends DispatchItem {
  success?: boolean;
  message?: string;
}

export interface JourneyParams {
  /** dispatch.MaterialDispatchId */
  objectEntryId: number | string;
  /** utils/deviceId.getDeviceId() */
  deviceId: string;
  /** Current position "lat,lng". */
  liveGPS: string;
}

export interface JourneyResult {
  success: boolean;
  message?: string;
  dispatchId?: string;
  objectEntryId?: string;
  statusDispatch?: number;
  arrived?: boolean;
  trackingActive?: boolean;
  nextStepAllowed?: boolean;
}

export interface GpsLiveResponse {
  dispatchId: string;
  vehicleId?: string;
  deviceId?: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
  speed?: number;
  heading?: number;
  timestamp?: string | number;
  plantName?: string;
  plantLatitude?: number;
  plantLongitude?: number;
  siteName?: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
  /** Backend sends a numeric string (e.g. "431"); tolerate a number too. */
  distanceToDestinationMeters?: number | string;
  distanceToDestinationKm?: string;
  trackingStatus?: string;
  journeyStatus?: string;
  statusDispatch?: number;
  arrived?: boolean;
}

export interface GpsHealthResponse {
  status: string;
  service?: string;
  redis?: string;
  websocketPort?: number;
  endpoint?: string;
  openConnections?: number;
  liferayDependency?: string;
  serverTime?: number;
}

/** Thrown by start/complete journey. `message` is safe to show to the driver. */
export class JourneyError extends Error {
  status?: number;
  body?: unknown;
  cause?: unknown;

  constructor(message: string, extra?: { status?: number; body?: unknown; cause?: unknown }) {
    super(message);
    this.name = 'JourneyError';
    this.status = extra?.status;
    this.body = extra?.body;
    this.cause = extra?.cause;
  }
}

/** Kept for existing imports. */
export const StartJourneyError = JourneyError;

function authHeaders(accessToken?: string, extra?: Record<string, string>): Record<string, string> {
  return {
    Accept: 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...(extra ?? {}),
  };
}

async function readJson(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** "17.385044,78.486671" — the format the collection uses for liveGPS. */
export function formatLiveGps(latitude: number, longitude: number): string {
  return `${latitude},${longitude}`;
}

/** Shared POST for start-journey / complete-journey (all params in the query string). */
async function postJourney(
  path: 'start-journey' | 'complete-journey',
  params: JourneyParams,
  accessToken?: string,
): Promise<JourneyResult> {
  const query = new URLSearchParams({
    objectEntryId: String(params.objectEntryId),
    deviceID: params.deviceId,
    liveGPS: params.liveGPS,
  });
  const url = `${getBaseUrl()}${DISPATCH_REST}/${path}?${query.toString()}`;
  const action = path === 'start-journey' ? 'start' : 'complete';

  console.log(`[driverGpsService] POST ${path}`, query.toString());

  let response: Response;
  try {
    response = await fetchWithTimeout(url, { method: 'POST', headers: authHeaders(accessToken) }, REQUEST_TIMEOUT_MS);
  } catch (err) {
    const isTimeout = err instanceof Error && err.message === 'TIMEOUT';
    throw new JourneyError(
      isTimeout
        ? 'The request timed out. Please try again.'
        : 'Unable to connect. Please check your internet connection.',
      { cause: err },
    );
  }

  const body = await readJson(response);

  if (!response.ok) {
    const message =
      response.status === 401
        ? 'Your session has expired. Please log in again.'
        : (typeof body?.message === 'string' && body.message) ||
          (typeof body?.error === 'string' && body.error) ||
          `Could not ${action} the journey (HTTP ${response.status}).`;
    throw new JourneyError(message, { status: response.status, body });
  }

  if (body && body.success === false) {
    throw new JourneyError(
      (typeof body.message === 'string' && body.message) || 'The server rejected the request.',
      { status: response.status, body },
    );
  }

  console.log(`[driverGpsService] ${path} ok:`, JSON.stringify(body));
  // The dispatch just changed state: nothing cached before this moment may be served again.
  clearJourneyCaches();
  return {
    success: true,
    message: typeof body?.message === 'string' ? body.message : undefined,
    dispatchId: body?.dispatchId ?? body?.dispatchID,
    objectEntryId: body?.objectEntryId !== undefined ? String(body.objectEntryId) : undefined,
    statusDispatch: typeof body?.statusDispatch === 'number' ? body.statusDispatch : undefined,
    arrived: body?.arrived,
    trackingActive: body?.trackingActive,
    nextStepAllowed: body?.nextStepAllowed,
  };
}

// ── Shared caches ────────────────────────────────────────────────────────────
// The active dispatch lives in the React Query cache (key: active-dispatch), shared by
// GlobalArrivalPrompt, BackgroundGpsController and the Live GPS screen: one request, one copy.
let healthCache: { at: number; value: GpsHealthResponse | null } | null = null;
let healthInFlight: Promise<GpsHealthResponse | null> | null = null;
const HEALTH_OK_TTL_MS = 30_000;
const HEALTH_FAIL_TTL_MS = 10_000;

function clearJourneyCaches(): void {
  invalidateJourneyData();
}

export const driverGpsService = {
  /**
   * Active dispatch merged with its detail (site position + pingHistory), shared by every caller.
   * Reuses a result that is at most `maxAgeMs` old and joins a request that is already running.
   * Failures are never cached, so the next caller simply tries again.
   */
  async getActiveWithDetail(
    userId: string | number,
    accessToken?: string,
    maxAgeMs = 10_000,
  ): Promise<DispatchItem | null> {
    try {
      return await fetchCached<DispatchItem>(
        qk.active(userId),
        async () => {
          let active: DispatchItem | null = await this.fetchActiveDispatch({ userId }, accessToken);
          const effectiveId = active?.MaterialDispatchId ?? active?.objectEntryId;
          if (active && effectiveId !== undefined) {
            const detail = await this.fetchDispatchDetail(effectiveId, userId, accessToken);
            if (detail) active = { ...active, ...detail, objectEntryId: detail.objectEntryId ?? active.objectEntryId };
          }
          // "No active dispatch" / a failed request is an error here, so it is never cached as data.
          if (!active) throw new Error('NO_ACTIVE_DISPATCH');
          return active;
        },
        maxAgeMs,
      );
    } catch {
      return null;
    }
  },

  /** Instant, no network: the last shared active dispatch if it is at most `maxAgeMs` old. */
  peekActiveWithDetail(userId: string | number, maxAgeMs = 120_000): DispatchItem | null {
    const state = queryClient.getQueryState<DispatchItem>(qk.active(userId));
    if (!state?.data || Date.now() - state.dataUpdatedAt > maxAgeMs) return null;
    return peekQuery<DispatchItem>(qk.active(userId)) ?? null;
  },

  /** Drop the shared copies (pull-to-refresh / Retry want the server's answer, not a cached one). */
  invalidateCaches(): void {
    clearJourneyCaches();
  },

  /**
   * Driver's current dispatch.
   * GET /o/material-dispatch-rest/driver/active-dispatch?userId={driverUserId}[&dispatchId=][&driverName=]
   * Returns null when the driver has no active dispatch (or on failure).
   */
  async fetchActiveDispatch(
    params: { userId: string | number; dispatchId?: string; driverName?: string },
    accessToken?: string,
  ): Promise<ActiveDispatchResponse | null> {
    try {
      const query = new URLSearchParams({ userId: String(params.userId) });
      if (params.dispatchId) query.append('dispatchId', params.dispatchId);
      if (params.driverName) query.append('driverName', params.driverName);

      const url = `${getBaseUrl()}${DISPATCH_REST}/driver/active-dispatch?${query.toString()}`;
      const response = await fetchWithTimeout(url, { headers: authHeaders(accessToken) }, REQUEST_TIMEOUT_MS);
      if (!response.ok) {
        console.warn('[driverGpsService] active-dispatch HTTP', response.status);
        // If filtered query failed and dispatchId was specified, retry without dispatchId
        if (params.dispatchId) {
          console.log('[driverGpsService] Retrying active-dispatch query unfiltered for userId:', params.userId);
          return await this.fetchActiveDispatch(
            { userId: params.userId, driverName: params.driverName },
            accessToken
          );
        }
        return null;
      }

      const data = await readJson(response);
      if (!data || data.success === false || !data.dispatchID) {
        if (params.dispatchId) {
          console.log('[driverGpsService] No active dispatch for filtered ID. Retrying unfiltered...');
          return await this.fetchActiveDispatch(
            { userId: params.userId, driverName: params.driverName },
            accessToken
          );
        }
        return null;
      }
      const normalized = normalizeDispatch(data) as ActiveDispatchResponse;

      // If active dispatch is missing genuine MaterialDispatchId, resolve from dispatches
      if (
        params.userId &&
        (!normalized.MaterialDispatchId || String(normalized.MaterialDispatchId) === String(normalized.dispatchID))
      ) {
        const enriched = await driverDashboardService.enrichDispatchIdentifiers(
          normalized,
          params.userId,
          accessToken
        );
        return enriched as ActiveDispatchResponse;
      }

      return normalized;
    } catch (err) {
      console.warn('[driverGpsService] fetchActiveDispatch failed:', err);
      return null;
    }
  },

  /**
   * One dispatch (incl. pingHistory).
   * GET /o/material-dispatch-rest/dispatch/{objectEntryId}?userId={driverUserId}
   */
  async fetchDispatchDetail(
    objectEntryId: number | string,
    userId: string | number,
    accessToken?: string,
  ): Promise<DispatchItem | null> {
    try {
      const url =
        `${getBaseUrl()}${DISPATCH_REST}/dispatch/${encodeURIComponent(String(objectEntryId))}` +
        `?userId=${encodeURIComponent(String(userId))}`;
      const response = await fetchWithTimeout(url, { headers: authHeaders(accessToken) }, REQUEST_TIMEOUT_MS);
      if (!response.ok) {
        console.warn(`[driverGpsService] dispatch detail HTTP ${response.status} for objectEntryId: ${objectEntryId}`);
        // If 404, objectEntryId was likely the business dispatchID (e.g. 746588, DSP-400002) instead of
        // the Liferay Object entry ID (MaterialDispatchId, e.g. 189236).
        if (response.status === 404 && userId) {
          try {
            console.log(`[driverGpsService] Resolving genuine MaterialDispatchId for dispatch ID: ${objectEntryId}`);
            // 1. Check active dispatch first
            const active = await this.fetchActiveDispatch({ userId }, accessToken);
            if (active) {
              const activeGenuineId = active.MaterialDispatchId ?? active.objectEntryId;
              if (activeGenuineId !== undefined && String(activeGenuineId) !== String(objectEntryId)) {
                console.log(`[driverGpsService] Resolved genuine MaterialDispatchId ${activeGenuineId} from active dispatch for ${objectEntryId}. Fetching detail...`);
                return await this.fetchDispatchDetail(activeGenuineId, userId, accessToken);
              }
            }

            // 2. Search dispatches list
            const dispatches = await driverDashboardService.getDispatches(String(userId), accessToken);
            const cleanTarget = String(objectEntryId).replace(/\D/g, '');
            const matched = dispatches.find((d: DispatchItem) => {
              if (!d) return false;
              if (d.dispatchID === String(objectEntryId)) return true;
              if (d.dispatchID?.toLowerCase() === String(objectEntryId).toLowerCase()) return true;
              if (cleanTarget && d.dispatchID && d.dispatchID.replace(/\D/g, '') === cleanTarget) return true;
              if (String(d.MaterialDispatchId) === String(objectEntryId) || String(d.objectEntryId) === String(objectEntryId)) return true;
              return false;
            }) ?? (dispatches.length === 1 ? dispatches[0] : null);

            const genuineId = matched?.MaterialDispatchId ?? matched?.objectEntryId;
            if (genuineId !== undefined && String(genuineId) !== String(objectEntryId)) {
              console.log(`[driverGpsService] Resolved genuine MaterialDispatchId ${genuineId} for ${objectEntryId}. Fetching detail...`);
              return await this.fetchDispatchDetail(genuineId, userId, accessToken);
            }
            if (matched) {
              return matched;
            }
          } catch (lookupErr) {
            console.warn('[driverGpsService] 404 fallback lookup failed:', lookupErr);
          }
        }
        return null;
      }
      const data = await readJson(response);
      if (!data || !data.dispatchID) return null;
      return normalizeDispatch(data);
    } catch (err) {
      console.warn('[driverGpsService] fetchDispatchDetail failed:', err);
      return null;
    }
  },

  /**
   * Stored GPS history of a dispatch (GPS Ping object, saved by the Liferay
   * scheduler) — the travelled route of a completed journey.
   * GET /o/material-dispatch-rest/history/{dispatchId}
   * Accepts a plain array or an object wrapping one. Returns [] on failure.
   */
  async fetchPingHistory(dispatchId: string, accessToken?: string): Promise<DispatchPingHistoryItem[]> {
    try {
      const url = `${getBaseUrl()}${DISPATCH_REST}/history/${encodeURIComponent(dispatchId)}`;
      const response = await fetchWithTimeout(url, { headers: authHeaders(accessToken) }, REQUEST_TIMEOUT_MS);
      if (!response.ok) {
        console.warn('[driverGpsService] history HTTP', response.status);
        return [];
      }
      const data = await readJson(response);
      const list: unknown = Array.isArray(data)
        ? data
        : data?.pingHistory ?? data?.history ?? data?.items ?? data?.pings ?? data?.data ?? [];
      if (!Array.isArray(list)) return [];
      return list
        .map((p: any) => ({
          latitude: Number(p?.latitude ?? p?.lat),
          longitude: Number(p?.longitude ?? p?.lng ?? p?.lon),
          deviceId: p?.deviceId,
          speed: typeof p?.speed === 'number' ? p.speed : undefined,
          timestamp: p?.timestamp !== undefined ? String(p.timestamp) : p?.gpsTimestamp,
        }))
        .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));
    } catch (err) {
      console.warn('[driverGpsService] fetchPingHistory failed:', err);
      return [];
    }
  },

  /**
   * Start Journey — sets In Transit and creates the Redis tracking state
   * (user:gps:{dispatchId}). Must succeed BEFORE the GPS WebSocket is opened.
   * POST /o/material-dispatch-rest/start-journey?objectEntryId=&deviceID=&liveGPS=
   * Throws JourneyError on any failure.
   */
  startJourney(params: JourneyParams, accessToken?: string): Promise<JourneyResult> {
    return postJourney('start-journey', params, accessToken);
  },

  /**
   * Complete Journey — marks Arrived. The app then closes the WebSocket.
   * POST /o/material-dispatch-rest/complete-journey?objectEntryId=&deviceID=&liveGPS=
   * Throws JourneyError on any failure.
   */
  completeJourney(params: JourneyParams, accessToken?: string): Promise<JourneyResult> {
    return postJourney('complete-journey', params, accessToken);
  },

  /**
   * Latest position + journey status from Redis (returns immediately).
   * GET /o/gps/live?dispatchId={dispatchId}
   * Used only for server-side status (arrival / distance) — never to move the map marker.
   */
  async fetchLiveLocation(dispatchId: string, accessToken?: string): Promise<GpsLiveResponse | null> {
    try {
      const url = `${getBaseUrl()}/o/gps/live?dispatchId=${encodeURIComponent(dispatchId)}`;
      const response = await fetchWithTimeout(url, { headers: authHeaders(accessToken) }, REQUEST_TIMEOUT_MS);
      if (!response.ok) return null;
      const data = await readJson(response);
      return data && data.dispatchId ? (data as GpsLiveResponse) : null;
    } catch (err) {
      console.warn('[driverGpsService] fetchLiveLocation failed:', err);
      return null;
    }
  },

  /**
   * Standalone GPS service health (no auth, works without Liferay).
   * GET {gpsHttp}/health -> { status: "UP", redis: "UP", ... }
   */
  async checkGpsServiceHealth(): Promise<GpsHealthResponse | null> {
    // Two effects on the Live GPS screen ask at the same moment: one request, remembered briefly.
    if (healthCache) {
      const ttl = healthCache.value ? HEALTH_OK_TTL_MS : HEALTH_FAIL_TTL_MS;
      if (Date.now() - healthCache.at <= ttl) return healthCache.value;
    }
    if (healthInFlight) return healthInFlight;

    healthInFlight = (async (): Promise<GpsHealthResponse | null> => {
      let value: GpsHealthResponse | null = null;
      try {
        const response = await fetchWithTimeout(`${getGpsHttpUrl()}/health`, {}, 5000);
        if (response.ok) value = (await readJson(response)) as GpsHealthResponse | null;
      } catch (err) {
        console.warn('[driverGpsService] GPS health check failed:', err);
      }
      healthCache = { at: Date.now(), value };
      return value;
    })().finally(() => {
      healthInFlight = null;
    });
    return healthInFlight;
  },
};

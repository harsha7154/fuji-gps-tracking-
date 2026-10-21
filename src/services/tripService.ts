import { fetchWithTimeout, getBaseUrl } from '../api/client';
import type {
  DispatchItem,
  DriverDashboardData,
  MaterialDispatchResponse,
} from '../types/driverDashboard';
import { normalizeDispatch, driverDashboardService } from './driverDashboardService';
import { driverGpsService } from './driverGpsService';
import { peekQuery, qk } from '../query/queryClient';
import { DISPATCH_STATUS } from '../utils/dispatchStatus';
import { getAuthSession } from './sessionStorage';

const REQUEST_TIMEOUT_MS = 15000;
const DISPATCH_REST = '/o/material-dispatch-rest';

async function authHeaders(accessToken?: string): Promise<Record<string, string>> {
  let token = accessToken;
  if (!token) {
    try {
      const session = await getAuthSession();
      if (session?.accessToken) {
        token = session.accessToken;
      }
    } catch { }
  }
  return {
    Accept: 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function readJson(response: any): Promise<any> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Service for fetching real material dispatch trip details from Liferay APIs:
 *   1. GET {baseURL}/o/material-dispatch-rest/driver/active-dispatch?userId={driverUserId}
 *   2. GET {baseURL}/o/material-dispatch-rest/dispatch/{objectEntryId}?userId={driverUserId}
 *   3. GET {baseURL}/o/material-dispatch-rest/dispatches?userId={driverUserId}&page={page}&pageSize={pageSize}
 */
export const tripService = {
  /**
   * Fetches the driver's current active dispatch.
   * GET /o/material-dispatch-rest/driver/active-dispatch?userId={driverUserId}[&dispatchId={dispatchId}]
   */
  async fetchActiveDispatch(
    userId: string,
    dispatchId?: string,
    accessToken?: string
  ): Promise<DispatchItem | null> {
    if (!userId || userId.trim() === '') {
      throw new Error('Driver user ID is required to fetch active dispatch.');
    }

    const query = new URLSearchParams({ userId: String(userId) });
    if (dispatchId) {
      query.append('dispatchId', dispatchId);
    }

    const url = `${getBaseUrl()}${DISPATCH_REST}/driver/active-dispatch?${query.toString()}`;

    try {
      const headers = await authHeaders(accessToken);
      const response = await fetchWithTimeout(url, { method: 'GET', headers }, REQUEST_TIMEOUT_MS);

      if (!response.ok) {
        if (__DEV__) {
          console.warn('[tripService] active-dispatch HTTP', response.status);
        }
        return null;
      }

      const data = await readJson(response);
      if (!data || data.success === false || (!data.dispatchID && !data.MaterialDispatchId && !data.objectEntryId)) {
        return null;
      }

      return normalizeDispatch(data);
    } catch (err) {
      if (__DEV__) {
        console.warn('[tripService] fetchActiveDispatch error:', err);
      }
      return null;
    }
  },

  /**
   * Fetches the full dispatch details by objectEntryId.
   * GET /o/material-dispatch-rest/dispatch/{objectEntryId}?userId={driverUserId}
   */
  async fetchDispatchDetail(
    objectEntryId: number | string,
    userId: string,
    accessToken?: string
  ): Promise<DispatchItem | null> {
    if (!objectEntryId) {
      return null;
    }
    if (!userId || String(userId).trim() === '') {
      throw new Error('Driver user ID is required to fetch dispatch detail.');
    }

    const url =
      `${getBaseUrl()}${DISPATCH_REST}/dispatch/${encodeURIComponent(String(objectEntryId))}` +
      `?userId=${encodeURIComponent(String(userId))}`;

    try {
      const headers = await authHeaders(accessToken);
      const response = await fetchWithTimeout(url, { method: 'GET', headers }, REQUEST_TIMEOUT_MS);

      if (!response.ok) {
        if (__DEV__) {
          console.warn('[tripService] dispatch detail HTTP', response.status, 'for objectEntryId', objectEntryId);
        }
        if (response.status === 404 && userId) {
          try {
            // Check active dispatch first
            const active = await this.fetchActiveDispatch(userId, undefined, accessToken);
            if (active) {
              const activeGenuineId = active.MaterialDispatchId ?? active.objectEntryId;
              if (activeGenuineId !== undefined && String(activeGenuineId) !== String(objectEntryId)) {
                return await this.fetchDispatchDetail(activeGenuineId, userId, accessToken);
              }
            }

            const list = await this.getDispatches(userId, 1, 20, accessToken);
            const cleanTarget = String(objectEntryId).replace(/\D/g, '');
            const matched = list.items?.find((d: DispatchItem) => {
              if (!d) return false;
              if (d.dispatchID === String(objectEntryId)) return true;
              if (d.dispatchID?.toLowerCase() === String(objectEntryId).toLowerCase()) return true;
              if (cleanTarget && d.dispatchID && d.dispatchID.replace(/\D/g, '') === cleanTarget) return true;
              if (String(d.MaterialDispatchId) === String(objectEntryId) || String(d.objectEntryId) === String(objectEntryId)) return true;
              return false;
            }) ?? (list.items && list.items.length === 1 ? list.items[0] : null);

            const realId = matched?.MaterialDispatchId ?? matched?.objectEntryId;
            if (realId && String(realId) !== String(objectEntryId)) {
              return await this.fetchDispatchDetail(realId, userId, accessToken);
            }
            if (matched) return normalizeDispatch(matched);
          } catch {
            // ignore
          }
        }
        return null;
      }

      const data = await readJson(response);
      if (!data) return null;

      return normalizeDispatch(data);
    } catch (err) {
      if (__DEV__) {
        console.warn('[tripService] fetchDispatchDetail error:', err);
      }
      return null;
    }
  },

  /**
   * Fetches paginated material dispatches for a driver.
   * GET /o/material-dispatch-rest/dispatches?userId={driverUserId}&page={page}&pageSize={pageSize}
   */
  async getDispatches(
    userId: string,
    page: number = 1,
    pageSize: number = 10,
    accessToken?: string
  ): Promise<MaterialDispatchResponse> {
    if (!userId || userId.trim() === '') {
      throw new Error('Driver user ID is required to fetch dispatches.');
    }

    const query = new URLSearchParams({
      userId: String(userId),
      page: String(page),
      pageSize: String(pageSize),
    });
    const url = `${getBaseUrl()}${DISPATCH_REST}/dispatches?${query.toString()}`;

    const headers = await authHeaders(accessToken);
    const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers,
      }, REQUEST_TIMEOUT_MS);

    if (!response.ok) {
      const error = new Error(`Request failed with status ${response.status}`);
      (error as any).status = response.status;
      throw error;
    }

    const data = await readJson(response);
    if (!data) {
      return {
        driverFullName: '',
        pageSize,
        page,
        totalCount: 0,
        items: [],
        userId,
      };
    }

    const rawList: any[] = Array.isArray(data)
      ? data
      : Array.isArray(data.items)
        ? data.items
        : Array.isArray(data.dispatches)
          ? data.dispatches
          : [];

    const normalizedItems: DispatchItem[] = rawList
      .filter((item: any) => item && typeof item.dispatchID === 'string' && item.dispatchID !== '')
      .map(normalizeDispatch);

    console.log(`[TRIP] dispatches page ${page}: ${normalizedItems.length} item(s)`);

    return {
      driverFullName: data.driverFullName || '',
      pageSize: data.pageSize || pageSize,
      page: data.page || page,
      totalCount: typeof data.totalCount === 'number' ? data.totalCount : normalizedItems.length,
      items: normalizedItems,
      userId: data.userId || userId,
    };
  },

  /**
   * Trip shown on the My Trip screen = dispatch + its detail.
   *
   * Fewest possible requests (the old version always made active-dispatch -> detail, even though the
   * arrival prompt / GPS controller had just loaded exactly that):
   *   - no dispatch picked  : the SHARED "active dispatch + detail" (driverGpsService.getActiveWithDetail)
   *                           -> 0 extra requests when it is already cached, else the same 2 calls, once.
   *   - dispatch picked     : looked up in the shared caches -> only the detail call is needed.
   *   - nothing found       : the SHARED dispatch list (not a separate page-1 request) picks one.
   * LOGS: filter with  [TRIP]
   */
  async getFullTripData(
    userId: string,
    selectedDispatchId?: string,
    accessToken?: string
  ): Promise<DispatchItem | null> {
    const startedAt = Date.now();
    const done = (source: string, result: DispatchItem | null): DispatchItem | null => {
      console.log(
        `[TRIP] ${result ? result.dispatchID : 'no dispatch'} <- ${source} in ${Date.now() - startedAt}ms`
      );
      return result;
    };

    let targetDispatch: DispatchItem | null = null;

    if (!selectedDispatchId) {
      // 1a. Current trip: shared active dispatch (already merged with its detail).
      const active = await driverGpsService.getActiveWithDetail(userId, accessToken, 15_000);
      if (active) return done('shared active dispatch', active);
    } else {
      // 1b. A specific dispatch was picked: use what is already loaded.
      const cachedActive = driverGpsService.peekActiveWithDetail(userId, 15_000);
      if (cachedActive && cachedActive.dispatchID === selectedDispatchId) {
        return done('shared active dispatch', cachedActive);
      }
      const cachedList = peekQuery<DriverDashboardData>(qk.dashboard(userId))?.dispatches;
      targetDispatch = cachedList?.find((d) => d.dispatchID === selectedDispatchId) ?? null;
      if (!targetDispatch) {
        targetDispatch = await this.fetchActiveDispatch(userId, selectedDispatchId, accessToken);
      }
    }

    // 2. Still nothing: pick from the shared dispatch list.
    if (!targetDispatch) {
      try {
        const items = await driverDashboardService.getDispatches(userId, accessToken, 20_000);
        if (items.length > 0) {
          if (selectedDispatchId) {
            targetDispatch = items.find((d) => d.dispatchID === selectedDispatchId) ?? null;
          }
          targetDispatch =
            targetDispatch ??
            items.find((d) => d.statusDispatch === DISPATCH_STATUS.IN_TRANSIT) ??
            items.find((d) => d.statusDispatch === DISPATCH_STATUS.DISPATCHED) ??
            items[0];
        }
      } catch (err) {
        console.warn('[TRIP] dispatch list fallback failed:', err instanceof Error ? err.message : err);
      }
    }

    if (!targetDispatch) return done('nothing found', null);

    // 3. Detail for the chosen dispatch (site position + pingHistory).
    const objectEntryId = targetDispatch.MaterialDispatchId ?? targetDispatch.objectEntryId;
    if (objectEntryId === undefined) return done('list only (no entry id)', targetDispatch);

    const dispatchDetail = await this.fetchDispatchDetail(objectEntryId, userId, accessToken);
    if (dispatchDetail) {
      targetDispatch = {
        ...targetDispatch,
        ...dispatchDetail,
        objectEntryId: dispatchDetail.objectEntryId ?? targetDispatch.objectEntryId,
      };
    }
    return done(dispatchDetail ? 'dispatch + detail' : 'dispatch (detail unavailable)', targetDispatch);
  },
};

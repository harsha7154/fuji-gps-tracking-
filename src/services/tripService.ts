import type {
  DispatchItem,
  DriverDashboardData,
  MaterialDispatchResponse,
} from '../types/driverDashboard';
import { driverDashboardService } from './driverDashboardService';
import { driverGpsService } from './driverGpsService';
import { peekQuery, qk } from '../query/queryClient';
import { DISPATCH_STATUS } from '../utils/dispatchStatus';


/**
 * Second safety check next to the server: the backend adds driverUserId to the
 * driver's own records; a record of another driver is never shown.
 */
function isOwnDispatch(item: DispatchItem | null | undefined, userId: string): boolean {
  const owner = (item as { driverUserId?: number | string } | null | undefined)?.driverUserId;
  return owner === undefined || owner === null || owner === '' || String(owner) === String(userId);
}



/**
 * Service for fetching real material dispatch trip details from Liferay APIs:
 *   1. GET {baseURL}/o/material-dispatch-rest/driver/active-dispatch?userId={driverUserId}
 *   2. GET {baseURL}/o/material-dispatch-rest/dispatch/{objectEntryId}?userId={driverUserId}
 *   3. GET {baseURL}/o/material-dispatch-rest/dispatches?userId={driverUserId}&page={page}&pageSize={pageSize}
 */
export const tripService = {
  /**
   * Driver's current active dispatch - the SHARED cached call (driverGpsService), so My Trip,
   * Live GPS, POD and the background components never ask the server for the same thing twice.
   * GET /o/material-dispatch-rest/driver/active-dispatch?userId=[&dispatchId=]
   */
  async fetchActiveDispatch(
    userId: string,
    dispatchId?: string,
    accessToken?: string
  ): Promise<DispatchItem | null> {
    if (!userId || userId.trim() === '') return null;
    return driverGpsService.fetchActiveDispatch(dispatchId ? { userId, dispatchId } : { userId }, accessToken);
  },

  /**
   * One dispatch with its detail - the SHARED cached call (driverGpsService).
   * GET /o/material-dispatch-rest/dispatch/{objectEntryId}?userId=
   */
  async fetchDispatchDetail(
    objectEntryId: number | string,
    userId: string,
    accessToken?: string
  ): Promise<DispatchItem | null> {
    if (!objectEntryId || !userId || String(userId).trim() === '') return null;
    return driverGpsService.fetchDispatchDetail(objectEntryId, userId, accessToken);
  },

  /**
   * The driver's dispatch list - the SHARED list of the dashboard (driverDashboardService),
   * paged here in memory. GET /o/material-dispatch-rest/dispatches?userId=
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
    const all = await driverDashboardService.getDispatches(userId, accessToken);
    const start = Math.max(0, (page - 1) * pageSize);
    return {
      driverFullName: '',
      pageSize,
      page,
      totalCount: all.length,
      items: all.slice(start, start + pageSize),
      userId,
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
        const items = await driverDashboardService.getDispatches(userId, accessToken, 60_000);
        if (items.length > 0) {
          if (selectedDispatchId) {
            targetDispatch = items.find((d) => d.dispatchID === selectedDispatchId) ?? null;
          }
          targetDispatch =
            targetDispatch ??
            items.find((d) => d.statusDispatch === DISPATCH_STATUS.IN_TRANSIT) ??
            items.find((d) => d.statusDispatch === DISPATCH_STATUS.DISPATCHED) ??
            null;
        }
      } catch (err) {
        console.warn('[TRIP] dispatch list fallback failed:', err instanceof Error ? err.message : err);
      }
    }

    if (!targetDispatch) return done('nothing found', null);
    if (!isOwnDispatch(targetDispatch, userId)) return done('not assigned to this driver', null);

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
    if (!isOwnDispatch(targetDispatch, userId)) return done('not assigned to this driver', null);
    return done(dispatchDetail ? 'dispatch + detail' : 'dispatch (detail unavailable)', targetDispatch);
  },
};

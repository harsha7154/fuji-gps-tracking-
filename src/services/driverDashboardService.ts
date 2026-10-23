/**
 * Truck Driver dashboard data service.
 *
 * Real API:
 *   GET {baseURL}/o/material-dispatch-rest/dispatches?userId={driverUserId}&page=1&pageSize=10
 * Returns every dispatch assigned to that driver's Liferay userId (paged —
 * all pages are fetched and merged here).
 *
 * Two entry points:
 *   - getDriverDashboard()  first load. NEVER throws — falls back to an
 *                           OFF_DUTY empty dashboard so the screen always renders.
 *   - getDispatches()       refresh/polling + tracking screen. THROWS on failure,
 *                           so a transient network error can't wipe the list the
 *                           driver is currently looking at.
 *
 * Every row is normalised so `statusDispatch` is always a real number when the
 * status can be determined (see utils/dispatchStatus.ts).
 */

import { fetchWithTimeout, getBaseUrl } from '../api/client';
import { fetchCached, qk } from '../query/queryClient';
import type {
  DispatchItem,
  DriverDashboardData,
  DriverWorkflow,
  MaterialDispatchResponse,
} from '../types/driverDashboard';
import { resolveDispatchStatus } from '../utils/dispatchStatus';
import { arrivalConfirmationService } from './arrivalConfirmationService';

const REQUEST_TIMEOUT_MS = 15000;

const DEFAULT_WORKFLOWS: DriverWorkflow[] = [
  { key: 'tripHistory', label: 'Trip History', sublabel: '42 Completed Runs' },
  { key: 'proofOfDelivery', label: 'Proof of Delivery', sublabel: 'e-POD Sign Off' },
];

function initialsFrom(fullName: string | undefined): string {
  const parts = (fullName ?? '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function toTitleCase(name: string | undefined): string {
  if (!name) return 'Driver';
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

const PAGE_SIZE = 50;
/** Used if the server refuses the larger page size (HTTP 400). */
const FALLBACK_PAGE_SIZE = 10;
/** Max simultaneous page requests when more than one page is needed. */
const PAGE_PARALLELISM = 5;
/** Safety cap so a misbehaving totalCount can never loop forever. */
const MAX_PAGES = 20;

function toFiniteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Normalises one dispatch row from any of the dispatch endpoints:
 *  - `statusDispatch` is a real number when derivable
 *  - `objectEntryId` is always set (the API calls it `MaterialDispatchId`)
 */
export function normalizeDispatch(item: DispatchItem): DispatchItem {
  const rawMaterialId = toFiniteNumber(
    item.MaterialDispatchId ??
    (item as any).materialDispatchId ??
    (item as any).id
  );
  const rawObjectId = toFiniteNumber(
    item.objectEntryId ??
    (item as any).entryID ??
    (item as any).entryId
  );
  const numericDispatchId = toFiniteNumber(item.dispatchID);

  // If objectEntryId was mistakenly populated with the business dispatchID,
  // it is not the internal Liferay Object entry ID.
  const isObjectIdBusinessCode =
    rawObjectId !== undefined && numericDispatchId !== undefined && rawObjectId === numericDispatchId;

  const genuineMaterialId = rawMaterialId ?? (!isObjectIdBusinessCode ? rawObjectId : undefined);
  const objectEntryId = genuineMaterialId ?? (!isObjectIdBusinessCode ? rawObjectId : undefined);

  return {
    ...item,
    MaterialDispatchId: genuineMaterialId,
    objectEntryId,
    destinationLatitude: toFiniteNumber(item.destinationLatitude),
    destinationLongitude: toFiniteNumber(item.destinationLongitude),
    statusDispatch: resolveDispatchStatus(item),
  };
}

/** Normalises every row and drops rows with no dispatchID. */
function normalizeItems(items: DispatchItem[] | undefined): DispatchItem[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((item) => item && typeof item.dispatchID === 'string' && item.dispatchID !== '')
    .map(normalizeDispatch);
}

async function fetchDispatchPage(
  userId: string,
  page: number,
  accessToken?: string,
  pageSize: number = PAGE_SIZE
): Promise<MaterialDispatchResponse> {
  const baseUrl = getBaseUrl();
  const query = new URLSearchParams({
    userId,
    page: String(page),
    pageSize: String(pageSize),
  });
  const url = `${baseUrl}/o/material-dispatch-rest/dispatches?${query.toString()}`;

  const response = await fetchWithTimeout(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        // Never served from an HTTP cache: a dispatch assigned a moment ago must show up.
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    }, REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    const error = new Error(`Request failed with status ${response.status}`);
    (error as any).status = response.status;
    throw error;
  }

  return (await response.json()) as MaterialDispatchResponse;
}

/** Several screens ask for the list at once; they share one in-flight load instead of each paging through it. */
const inFlightLoads = new Map<string, Promise<MaterialDispatchResponse>>();

/**
 * Fetches page 1, then the remaining pages IN PARALLEL (a few at a time) until `totalCount` items
 * are loaded. (It used to fetch 10 items per request, one request after another.)
 */
async function fetchDispatches(
  userId: string,
  accessToken?: string
): Promise<MaterialDispatchResponse> {
  const existing = inFlightLoads.get(userId);
  if (existing) {
    console.log(`[dispatches] user ${userId}: joining the load already in progress`);
    return existing;
  }
  const load = loadAllDispatches(userId, accessToken).finally(() => {
    inFlightLoads.delete(userId);
  });
  inFlightLoads.set(userId, load);
  return load;
}

async function loadAllDispatches(
  userId: string,
  accessToken?: string
): Promise<MaterialDispatchResponse> {
  const startedAt = Date.now();
  let pageSize = PAGE_SIZE;
  let first: MaterialDispatchResponse;
  try {
    first = await fetchDispatchPage(userId, 1, accessToken, pageSize);
  } catch (err) {
    if ((err as any)?.status === 400 && pageSize !== FALLBACK_PAGE_SIZE) {
      console.warn(`[dispatches] server refused pageSize=${pageSize}, retrying with ${FALLBACK_PAGE_SIZE}`);
      pageSize = FALLBACK_PAGE_SIZE;
      first = await fetchDispatchPage(userId, 1, accessToken, pageSize);
    } else {
      throw err;
    }
  }

  const items: DispatchItem[] = Array.isArray(first.items) ? [...first.items] : [];
  const total = toFiniteNumber(first.totalCount) ?? items.length;
  // The server may cap the page size, so derive the real page length from what it returned.
  const perPage = items.length;
  let page = 1;

  if (items.length < total && perPage > 0) {
    const lastPage = Math.min(MAX_PAGES, Math.ceil(total / perPage));
    for (let start = 2; start <= lastPage; start += PAGE_PARALLELISM) {
      const batch: Promise<MaterialDispatchResponse>[] = [];
      for (let p = start; p < start + PAGE_PARALLELISM && p <= lastPage; p += 1) {
        batch.push(fetchDispatchPage(userId, p, accessToken, pageSize));
      }
      const results = await Promise.all(batch);
      for (const r of results) {
        if (Array.isArray(r.items)) items.push(...r.items);
      }
      page = Math.min(lastPage, start + PAGE_PARALLELISM - 1);
    }
  }

  // Safety net: if paging was inconsistent and items are still missing, continue page by page.
  let lastPageSize = perPage;
  while (items.length < total && lastPageSize > 0 && page < MAX_PAGES) {
    page += 1;
    const next = await fetchDispatchPage(userId, page, accessToken, pageSize);
    const nextItems = Array.isArray(next.items) ? next.items : [];
    lastPageSize = nextItems.length;
    items.push(...nextItems);
  }

  // De-duplicate by dispatchID in case pages overlap.
  const seen = new Set<string>();
  const unique = items.filter((d) => {
    if (!d?.dispatchID || seen.has(d.dispatchID)) return false;
    seen.add(d.dispatchID);
    return true;
  });

  console.log(
    `[dispatches] user ${userId}: ${unique.length}/${total} items, ${page} page(s) of ${pageSize}, ${Date.now() - startedAt} ms`
  );
  return { ...first, items: unique };
}

/** How long a downloaded dispatch list is reused before the next caller downloads it again. */
const DISPATCH_LIST_STALE_MS = 8_000;

/** Whole dashboard payload. Throws on failure, so a failed refresh never replaces good cached data. */
async function fetchDashboardData(userId: string, accessToken?: string): Promise<DriverDashboardData> {
  const data = await fetchDispatches(userId, accessToken);
  const dispatches = normalizeItems(data.items);
  const primary = dispatches[0];
  return {
    driver: {
      name: toTitleCase(data.driverFullName || 'Driver'),
      vehicleNumber: primary?.vehicleNumber ?? '',
      vehicleModel: '',
      dutyStatus: 'ON_DUTY',
      avatarInitials: initialsFrom(data.driverFullName || 'Driver'),
    },
    dispatches,
    workflows: DEFAULT_WORKFLOWS,
    notificationCount: 0,
  };
}

export const driverDashboardService = {
  /** Strict dashboard load (throws). This is the queryFn of the dashboard query. */
  fetchDashboard(userId: string, accessToken?: string): Promise<DriverDashboardData> {
    return fetchDashboardData(String(userId), accessToken);
  },

  /** Fresh, normalised dispatch list. Throws on any failure (network, HTTP, timeout). */
  /**
   * Dispatch list, shared through the query cache with the dashboard and every other caller:
   * a list younger than `maxAgeMs` is reused, otherwise ONE request is made (0 = always ask the server).
   * Returns copies, so a caller that edits an item cannot change what other screens see.
   */
  async getDispatches(
    userId: string,
    accessToken?: string,
    maxAgeMs: number = DISPATCH_LIST_STALE_MS,
  ): Promise<DispatchItem[]> {
    const dashboard = await fetchCached(
      qk.dashboard(userId),
      () => fetchDashboardData(String(userId), accessToken),
      maxAgeMs,
    );
    return dashboard.dispatches.map((d) => ({ ...d }));
  },

  /** Same list, reusing a copy up to `maxAgeMs` old (identifier look-ups). */
  getRecentDispatches(userId: string, accessToken?: string, maxAgeMs = 15_000): Promise<DispatchItem[]> {
    return this.getDispatches(userId, accessToken, maxAgeMs);
  },

  /**
   * Resolves genuine MaterialDispatchId (Liferay Object entry ID) and arrival state
   * from the authoritative dispatches list if the given dispatch lacks it or has a business code collision.
   */
  async enrichDispatchIdentifiers(
    dispatch: DispatchItem,
    userId: string | number,
    accessToken?: string
  ): Promise<DispatchItem> {
    const hasValidMaterialId =
      dispatch.MaterialDispatchId !== undefined &&
      String(dispatch.MaterialDispatchId) !== String(dispatch.dispatchID);
    if (hasValidMaterialId) {
      return dispatch;
    }

    try {
      const dispatches = await this.getRecentDispatches(String(userId), accessToken);
      const cleanTargetId = dispatch.dispatchID ? dispatch.dispatchID.replace(/\D/g, '') : '';
      const matched =
        dispatches.find((d) => {
          if (!d) return false;
          if (d.dispatchID === dispatch.dispatchID) return true;
          if (d.dispatchID?.toLowerCase() === dispatch.dispatchID?.toLowerCase()) return true;
          if (cleanTargetId && d.dispatchID && d.dispatchID.replace(/\D/g, '') === cleanTargetId) return true;
          if (
            dispatch.objectEntryId !== undefined &&
            (d.MaterialDispatchId === dispatch.objectEntryId || d.objectEntryId === dispatch.objectEntryId)
          ) {
            return true;
          }
          return false;
        }) ??
        (dispatches.length === 1 ? dispatches[0] : null);

      const resolvedMaterialId = matched?.MaterialDispatchId ?? matched?.objectEntryId;
      if (matched && resolvedMaterialId !== undefined) {
        console.log('[driverDashboardService] Enriched dispatch identifiers:', {
          dispatchID: dispatch.dispatchID,
          MaterialDispatchId: resolvedMaterialId,
          objectEntryId: resolvedMaterialId,
        });
        const candidateStatus = dispatch.statusDispatch ?? matched.statusDispatch;
        const effectiveStatus = arrivalConfirmationService.getEffectiveStatus(
          dispatch.dispatchID,
          candidateStatus
        );
        return {
          ...matched,
          ...dispatch,
          MaterialDispatchId: resolvedMaterialId,
          objectEntryId: resolvedMaterialId,
          statusDispatch: effectiveStatus,
          arrived: effectiveStatus === 0,
        };
      }
    } catch (err) {
      console.warn('[driverDashboardService] enrichDispatchIdentifiers error:', err);
    }
    return dispatch;
  },
};

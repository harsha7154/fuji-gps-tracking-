/**
 * Liferay user notifications.
 *
 * 0. List (preferred): the app's own backend, read from the database
 *      GET {base}/o/mobile-auth/notifications?page=&pageSize=
 *    -> { items: [{ id, read, dateCreated, eventType, payload }], totalCount, lastPage, unreadCount }
 *    Each item already carries its payload, so no per-item lookups are needed.
 *    Liferay's headless list (below) reads the SEARCH INDEX and answers 404 for the whole
 *    page when the index still holds a deleted notification; it is only used when the
 *    backend endpoint is not deployed (404).
 *
 * 1. Headless User Notification API (list, read state, mark as read)
 *      GET {base}/o/headless-user-notification/v1.0/my-user-notifications
 *      PUT {base}/o/headless-user-notification/v1.0/user-notifications/{id}/read
 *    Delete (single / selected) goes through the app's own backend, which removes
 *    the Liferay UserNotificationEvent only for the token user:
 *      POST {base}/o/mobile-auth/notifications/delete   { ids: [...] }
 *    For these notifications Liferay returns `message: ""` (no notification
 *    handler renders them), so the text has to come from:
 *
 * 2. JSONWS UserNotificationEvent (the stored event, incl. its JSON `payload`)
 *      POST {base}/api/jsonws/usernotificationevent/get-user-notification-event
 *      Content-Type: application/x-www-form-urlencoded
 *      body: userNotificationEventId={id}
 *    (same call as the Postman request; the app authenticates with the OAuth
 *    Bearer token instead of a JSESSIONID cookie)
 *    The headless `id` IS the userNotificationEventId, so each headless item is
 *    enriched with its event payload (one list, no duplicates).
 *
 * 3. If the payload only points at a Notification Queue Entry (notification
 *    templates), subject/body are read from
 *      GET {base}/o/notification/v1.0/notification-queue-entries/{id}
 *
 * Enrichment never breaks the list: any lookup that fails is skipped and the
 * screen falls back to its default text. Results are cached per id.
 *
 * Every call goes through requestWithTokenRefresh(), so an expired access
 * token is refreshed once and the request retried; the new tokens are handed
 * back to AppNavigator through `onTokenRefresh`.
 *
 * Used by NotificationsScreen (list + mark as read) and AppNavigator (unread
 * badge count shown in every driver screen header).
 */

import { getBaseUrl, requestWithTokenRefresh } from '../api/client';

const NOTIFICATIONS_PATH = '/o/headless-user-notification/v1.0';
const PAGE_SIZE = 100;

export type TokenRefreshHandler = (
  newAccessToken: string,
  newRefreshToken: string,
  newExpiresAt: string,
) => void;

/** HATEOAS action, e.g. actions.read = { href, method }. */
export interface LiferayNotificationAction {
  href?: string;
  method?: string;
}

/** One item of `my-user-notifications` → `items[]`. */
export interface LiferayNotification {
  id: number;
  /** Plain text, HTML, or a JSON string — see NotificationsScreen helpers. */
  message?: string;
  /** Not part of the standard schema, but some notification handlers send it. */
  payload?: unknown;
  read?: boolean;
  dateCreated?: string;
  type?: number;
  actions?: Record<string, LiferayNotificationAction | undefined>;
  /** Optional deep link resolved by the backend / handler. */
  actionUrl?: string;
  actionLabel?: string;
  /** Handler portlet id from the JSONWS event (set by enrichment). */
  eventType?: string;
}

interface LiferayPage<T> {
  items?: T[];
  totalCount?: number;
  page?: number;
  pageSize?: number;
  lastPage?: number;
  /** Sent by /o/mobile-auth/notifications only. */
  unreadCount?: number;
}

/** One page of the notification list (infinite scroll). */
export interface NotificationPage {
  items: LiferayNotification[];
  page: number;
  pageSize: number;
  totalCount: number;
  /** More pages exist on the server. */
  hasMore: boolean;
  /** Unread notifications on the server (backend list only; undefined with the headless fallback). */
  unreadCount?: number;
}

/** Page size of the notification screen's infinite scroll. */
export const NOTIFICATION_PAGE_SIZE = 50;

/** Backend limit of POST /o/mobile-auth/notifications/delete. */
const DELETE_BATCH_SIZE = 500;

const MOBILE_NOTIFICATIONS_PATH = '/o/mobile-auth/notifications';
/** Bell badge: newest items needed to spot new ones (the unread count comes from the server). */
const BADGE_PAGE_SIZE = 20;
/** Backend list missing (404 = module not deployed yet): use headless, try the backend again after this. */
const MOBILE_LIST_RETRY_MS = 5 * 60_000;
let mobileListMissingAt = 0;

type ListPage = LiferayPage<LiferayNotification>;

/** GET /o/mobile-auth/notifications. Returns null when the endpoint is not deployed (404). Throws on other failures. */
async function fetchMobilePage(
  accessToken: string,
  refreshToken: string,
  onTokenRefresh: TokenRefreshHandler | undefined,
  page: number,
  pageSize: number,
  onSessionExpired?: () => void,
): Promise<ListPage | null> {
  if (mobileListMissingAt && Date.now() - mobileListMissingAt < MOBILE_LIST_RETRY_MS) return null;

  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const url = `${getBaseUrl()}${MOBILE_NOTIFICATIONS_PATH}?${query.toString()}`;
  const { response } = await requestWithTokenRefresh(
    url,
    accessToken,
    refreshToken,
    { method: 'GET', headers: { Accept: 'application/json' } },
    onTokenRefresh,
    onSessionExpired,
  );
  if (response.status === 404) {
    mobileListMissingAt = Date.now();
    console.warn('[notificationService] /o/mobile-auth/notifications not deployed - using the headless list');
    return null;
  }
  await throwIfNotOk(response, 'Load notifications');
  mobileListMissingAt = 0;
  return (await response.json()) as ListPage;
}

/** GET headless my-user-notifications (fallback). Throws on failure. */
async function fetchHeadlessPage(
  accessToken: string,
  refreshToken: string,
  onTokenRefresh: TokenRefreshHandler | undefined,
  page: number,
  pageSize: number,
  onSessionExpired?: () => void,
): Promise<ListPage> {
  const query = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
    sort: 'dateCreated:desc',
  });
  const url = `${getBaseUrl()}${NOTIFICATIONS_PATH}/my-user-notifications?${query.toString()}`;
  const { response } = await requestWithTokenRefresh(
    url,
    accessToken,
    refreshToken,
    { method: 'GET', headers: { Accept: 'application/json' } },
    onTokenRefresh,
    onSessionExpired,
  );
  await throwIfNotOk(response, 'Load notifications');
  return (await response.json()) as ListPage;
}

/** Backend list first, headless list when the backend endpoint is not deployed. */
async function fetchListPage(
  accessToken: string,
  refreshToken: string,
  onTokenRefresh: TokenRefreshHandler | undefined,
  page: number,
  pageSize: number,
  onSessionExpired?: () => void,
): Promise<ListPage> {
  return (
    (await fetchMobilePage(accessToken, refreshToken, onTokenRefresh, page, pageSize, onSessionExpired)) ??
    (await fetchHeadlessPage(accessToken, refreshToken, onTokenRefresh, page, pageSize, onSessionExpired))
  );
}

async function throwIfNotOk(response: Response, what: string): Promise<void> {
  if (response.ok) return;
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // not JSON
  }
  const error = new Error(`${what} failed with status ${response.status}`);
  (error as any).status = response.status;
  (error as any).body = body;
  throw error;
}

/** Stored event, as returned by JSONWS /usernotificationevent/get-user-notification-event. */
export interface UserNotificationEvent {
  userNotificationEventId?: number;
  uuid?: string;
  companyId?: number;
  userId?: number;
  /** Portlet id of the notification handler. */
  type?: string;
  timestamp?: number;
  deliveryType?: number;
  delivered?: boolean;
  actionRequired?: boolean;
  archived?: boolean;
  /** JSON string. */
  payload?: string;
}

const ENRICH_CONCURRENCY = 5;

// Events / queue entries never change, so cache them for the app session.
const eventCache = new Map<string, UserNotificationEvent | null>();
const queueEntryCache = new Map<string, { subject?: string; body?: string } | null>();

function isBlankMessage(message: string | undefined): boolean {
  return !message || message.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim() === '';
}

function parseObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

const TEXT_KEYS = ['title', 'subject', 'body', 'description', 'message', 'notificationMessage', 'checkpointName', 'name'];

function hasDisplayText(payload: Record<string, unknown> | null): boolean {
  return !!payload && TEXT_KEYS.some((k) => typeof payload[k] === 'string' && (payload[k] as string).trim() !== '');
}

/** Runs `worker` over `items` with at most `limit` in flight. */
async function mapLimit<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function getJson(
  url: string,
  accessToken: string,
  refreshToken: string,
  onTokenRefresh?: TokenRefreshHandler,
  init: RequestInit = { method: 'GET', headers: { Accept: 'application/json' } },
): Promise<any | null> {
  const { response } = await requestWithTokenRefresh(url, accessToken, refreshToken, init, onTokenRefresh);
  if (!response.ok) {
    console.warn('[notificationService]', init.method ?? 'GET', url, '->', response.status);
    return null;
  }
  const data = await response.json().catch(() => null);
  // JSONWS reports failures as 200 + { exception: "..." }.
  if (data && typeof data === 'object' && 'exception' in data) {
    console.warn('[notificationService] JSONWS error for', url, '->', (data as any).exception);
    return null;
  }
  return data;
}

/** JSONWS: the stored UserNotificationEvent (with payload) for one notification id. */
async function fetchUserNotificationEvent(
  id: number | string,
  accessToken: string,
  refreshToken: string,
  onTokenRefresh?: TokenRefreshHandler,
): Promise<UserNotificationEvent | null> {
  const key = String(id);
  if (eventCache.has(key)) return eventCache.get(key) ?? null;

  const url = `${getBaseUrl()}/api/jsonws/usernotificationevent/get-user-notification-event`;
  try {
    const data = (await getJson(url, accessToken, refreshToken, onTokenRefresh, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ userNotificationEventId: key }).toString(),
    })) as UserNotificationEvent | null;
    eventCache.set(key, data);
    return data;
  } catch (err) {
    console.warn('[notificationService] JSONWS event lookup failed for', key, err);
    return null; // not cached: retried on the next load
  }
}

/** Headless Notification API: subject/body of a notification-template queue entry. */
async function fetchQueueEntry(
  id: number | string,
  accessToken: string,
  refreshToken: string,
  onTokenRefresh?: TokenRefreshHandler,
): Promise<{ subject?: string; body?: string } | null> {
  const key = String(id);
  if (queueEntryCache.has(key)) return queueEntryCache.get(key) ?? null;

  const url = `${getBaseUrl()}/o/notification/v1.0/notification-queue-entries/${encodeURIComponent(key)}`;
  try {
    const data = await getJson(url, accessToken, refreshToken, onTokenRefresh);
    const entry = data
      ? {
          subject: typeof data.subject === 'string' ? data.subject : undefined,
          body: typeof data.body === 'string' ? data.body : undefined,
        }
      : null;
    queueEntryCache.set(key, entry);
    return entry;
  } catch (err) {
    console.warn('[notificationService] queue entry lookup failed for', key, err);
    return null;
  }
}

/**
 * Fills `payload` for every notification whose headless `message` is empty,
 * using the JSONWS event (and, if needed, the notification queue entry).
 */
export async function enrichNotifications(
  items: LiferayNotification[],
  accessToken: string,
  refreshToken: string,
  onTokenRefresh?: TokenRefreshHandler,
): Promise<LiferayNotification[]> {
  const needsText = items.filter((n) => isBlankMessage(n.message) && !hasDisplayText(parseObject(n.payload)));
  if (needsText.length === 0) return items;

  const enriched = new Map<number, Partial<LiferayNotification>>();
  const enrichStartedAt = Date.now();

  await mapLimit(needsText, ENRICH_CONCURRENCY, async (n) => {
    // The backend list already sends the payload: only the headless list needs the JSONWS lookup.
    const ownPayload = parseObject(n.payload);
    const event = ownPayload ? null : await fetchUserNotificationEvent(n.id, accessToken, refreshToken, onTokenRefresh);
    if (!ownPayload && !event) return;

    let payload = ownPayload ?? parseObject(event?.payload) ?? {};

    // Notification templates: the payload only references the queue entry.
    const queueEntryId =
      payload.notificationQueueEntryId ?? payload.notificationQueueEntryID ?? payload.queueEntryId;
    if (!hasDisplayText(payload) && (typeof queueEntryId === 'number' || typeof queueEntryId === 'string')) {
      const entry = await fetchQueueEntry(queueEntryId, accessToken, refreshToken, onTokenRefresh);
      if (entry) {
        payload = { ...payload, title: entry.subject ?? payload.title, body: entry.body ?? payload.body };
      }
    }

    enriched.set(n.id, {
      payload,
      eventType: n.eventType ?? event?.type,
      // List `dateCreated` is authoritative; fall back to the event timestamp.
      dateCreated: n.dateCreated ?? (event?.timestamp ? new Date(event.timestamp).toISOString() : undefined),
    });
  });

  const sample = needsText.find((n) => enriched.has(n.id));
  if (sample) {
    // console.log(
      // '[notificationService] JSONWS payload for',
      // sample.id,
      // ':',
      // JSON.stringify(enriched.get(sample.id)?.payload).slice(0, 500),
    // );
  } else {
    console.warn('[notificationService] JSONWS enrichment returned nothing for', needsText.length, 'notification(s).');
  }

  console.log(
    `[notifications] text lookup: ${enriched.size}/${needsText.length} item(s) in ${Date.now() - enrichStartedAt}ms`,
  );
  return items.map((n) => (enriched.has(n.id) ? { ...n, ...enriched.get(n.id) } : n));
}

export interface NotificationOptions {
  enrich?: boolean;
  onSessionExpired?: () => void;
}

export const notificationService = {
  /**
   * Newest first. Throws on network / HTTP failure of the headless list.
   * `enrich` (default true) adds the JSONWS payload text; the badge count skips it.
   */
  async getNotifications(
    accessToken: string,
    refreshToken: string,
    onTokenRefresh?: TokenRefreshHandler,
    options: NotificationOptions = {},
  ): Promise<LiferayNotification[]> {
    const data = await fetchListPage(accessToken, refreshToken, onTokenRefresh, 1, PAGE_SIZE, options.onSessionExpired);
    const items = Array.isArray(data.items) ? data.items : [];

    if (options.enrich === false) return items;
    return enrichNotifications(items, accessToken, refreshToken, onTokenRefresh);
  },

  /**
   * One page of the list, newest first (infinite scroll on the notification screen).
   * GET /o/mobile-auth/notifications?page=&pageSize=  (headless list if the backend is not deployed)
   * Throws on network / HTTP failure. Only this page's items are text-enriched.
   */
  async getNotificationsPage(
    accessToken: string,
    refreshToken: string,
    onTokenRefresh: TokenRefreshHandler | undefined,
    page: number,
    pageSize: number = NOTIFICATION_PAGE_SIZE,
    options: NotificationOptions = {},
  ): Promise<NotificationPage> {
    const data = await fetchListPage(accessToken, refreshToken, onTokenRefresh, page, pageSize, options.onSessionExpired);
    const raw = Array.isArray(data.items) ? data.items : [];
    const totalCount = typeof data.totalCount === 'number' ? data.totalCount : raw.length;
    const hasMore =
      typeof data.lastPage === 'number'
        ? page < data.lastPage
        : typeof data.totalCount === 'number'
          ? page * pageSize < data.totalCount
          : raw.length === pageSize;

    const items =
      options.enrich === false ? raw : await enrichNotifications(raw, accessToken, refreshToken, onTokenRefresh);
    const unreadCount = typeof data.unreadCount === 'number' ? data.unreadCount : undefined;
    return { items, page, pageSize, totalCount, hasMore, unreadCount };
  },

  /**
   * Bell badge: newest items (to spot new ones) + unread count, without text lookups.
   * Backend list: 20 items + the server's unread count. Headless fallback: 100 items, counted here.
   */
  async getBadgeSnapshot(
    accessToken: string,
    refreshToken: string,
    onTokenRefresh?: TokenRefreshHandler,
    onSessionExpired?: () => void,
  ): Promise<{ items: LiferayNotification[]; unreadCount: number }> {
    const mobile = await fetchMobilePage(accessToken, refreshToken, onTokenRefresh, 1, BADGE_PAGE_SIZE, onSessionExpired);
    if (mobile) {
      const items = Array.isArray(mobile.items) ? mobile.items : [];
      const unreadCount =
        typeof mobile.unreadCount === 'number' ? mobile.unreadCount : items.filter((n) => !n.read).length;
      return { items, unreadCount };
    }
    const headless = await fetchHeadlessPage(accessToken, refreshToken, onTokenRefresh, 1, PAGE_SIZE, onSessionExpired);
    const items = Array.isArray(headless.items) ? headless.items : [];
    return { items, unreadCount: items.filter((n) => !n.read).length };
  },

  /** Marks one notification as read. Throws on failure. */
  async markAsRead(
    notificationId: number | string,
    accessToken: string,
    refreshToken: string,
    onTokenRefresh?: TokenRefreshHandler,
    onSessionExpired?: () => void,
  ): Promise<void> {
    const url =
      `${getBaseUrl()}${NOTIFICATIONS_PATH}/user-notifications/` +
      `${encodeURIComponent(String(notificationId))}/read`;

    const { response } = await requestWithTokenRefresh(
      url,
      accessToken,
      refreshToken,
      { method: 'PUT', headers: { Accept: 'application/json' } },
      onTokenRefresh,
      onSessionExpired,
    );
    await throwIfNotOk(response, 'Mark notification as read');
  },

  /**
   * Deletes notifications of the logged-in user in one request:
   *   POST /o/mobile-auth/notifications/delete  { ids: [...] }
   * Backend deletes the Liferay UserNotificationEvent only when it belongs to the
   * token user. Returns the ids now gone on the server (deleted + already-gone/skipped
   * are reported separately). Throws on HTTP failure.
   */
  async deleteNotifications(
    ids: Array<number | string>,
    accessToken: string,
    refreshToken: string,
    onTokenRefresh?: TokenRefreshHandler,
    onSessionExpired?: () => void,
  ): Promise<{ deleted: number[]; skipped: number[] }> {
    const unique = Array.from(new Set(ids.map((id) => Number(id)).filter((id) => id > 0)));
    const result = { deleted: [] as number[], skipped: [] as number[] };
    if (unique.length === 0) return result;

    const url = `${getBaseUrl()}/o/mobile-auth/notifications/delete`;
    for (let i = 0; i < unique.length; i += DELETE_BATCH_SIZE) {
      const batch = unique.slice(i, i + DELETE_BATCH_SIZE);
      const { response } = await requestWithTokenRefresh(
        url,
        accessToken,
        refreshToken,
        {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: batch }),
        },
        onTokenRefresh,
        onSessionExpired,
      );
      await throwIfNotOk(response, 'Delete notifications');
      const data = await response.json().catch(() => null);
      result.deleted.push(...((data?.deleted as number[]) ?? batch));
      result.skipped.push(...((data?.skipped as number[]) ?? []));
    }
    for (const id of unique) eventCache.delete(String(id));
    return result;
  },

  /** Number of unread notifications (for the header bell badge). Never throws — returns null on failure. */
  async getUnreadCount(
    accessToken: string,
    refreshToken: string,
    onTokenRefresh?: TokenRefreshHandler,
    onSessionExpired?: () => void,
  ): Promise<number | null> {
    try {
      const { unreadCount } = await notificationService.getBadgeSnapshot(
        accessToken,
        refreshToken,
        onTokenRefresh,
        onSessionExpired,
      );
      return unreadCount;
    } catch (err) {
      console.warn('[notificationService] getUnreadCount failed:', err);
      return null;
    }
  },
};

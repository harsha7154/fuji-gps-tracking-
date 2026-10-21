/**
 * Detects NEW notifications for the signed-in user.
 *
 * Used by both:
 *   - AppNavigator (app open)  -> every 30 s, shows the in-app toast
 *   - the background task      -> every ~15 min (OS decides), shows a system notification
 *
 * How "new" is decided: Liferay notification ids (userNotificationEventId)
 * only ever increase, so we remember the highest id the user has already been
 * told about (per user, in SecureStore / localStorage). Anything unread with a
 * higher id is new. The very first check after install/login only stores the
 * baseline, so the user isn't flooded with old notifications.
 */

import { appStorage } from './sessionStorage';
import {
  notificationService,
  enrichNotifications,
  LiferayNotification,
  TokenRefreshHandler,
} from './notificationService';

const seenKey = (userId: string) => `fuji_notif_last_seen_${String(userId).replace(/[^A-Za-z0-9._-]/g, '_')}`;

export interface NotificationCheckResult {
  /** Full list (newest first). NOT text-enriched: the poll only needs ids + read state. */
  items: LiferayNotification[];
  /** Unread notifications that arrived since the last check, newest first. */
  newItems: LiferayNotification[];
  unreadCount: number;
}

async function readLastSeenId(userId: string): Promise<number | null> {
  try {
    const raw = await appStorage.getItem(seenKey(userId));
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Newest notification id this device has already told the user about (null if none yet). Used as the push relay's starting point. */
export async function getLastSeenNotificationId(userId: string): Promise<number | null> {
  return readLastSeenId(userId);
}

async function writeLastSeenId(userId: string, id: number): Promise<void> {
  try {
    await appStorage.setItem(seenKey(userId), String(id));
  } catch (err) {
    console.warn('[notificationWatcher] could not save last seen id:', err);
  }
}

// Foreground poll and background task can overlap; run one check at a time.
let inFlight: Promise<NotificationCheckResult> | null = null;

export function checkForNewNotifications(params: {
  userId: string;
  accessToken: string;
  refreshToken: string;
  onTokenRefresh?: TokenRefreshHandler;
  onSessionExpired?: () => void;
}): Promise<NotificationCheckResult> {
  if (inFlight) return inFlight;

  const run = (async () => {
    const startedAt = Date.now();
    // Light list only (no per-item text lookups): this runs every 30 s.
    const items = await notificationService.getNotifications(
      params.accessToken,
      params.refreshToken,
      params.onTokenRefresh,
      { onSessionExpired: params.onSessionExpired, enrich: false },
    );

    const unreadCount = items.filter((n) => !n.read).length;
    const maxId = items.reduce((max, n) => (typeof n.id === 'number' && n.id > max ? n.id : max), 0);
    const lastSeen = await readLastSeenId(params.userId);

    let newItems: LiferayNotification[] = [];
    if (lastSeen === null) {
      // First run for this user: remember where we are, alert nothing.
      if (maxId > 0) await writeLastSeenId(params.userId, maxId);
    } else {
      newItems = items.filter((n) => typeof n.id === 'number' && n.id > lastSeen && !n.read);
      if (maxId > lastSeen) await writeLastSeenId(params.userId, maxId);
    }

    // Only NEW notifications need their text (toast / system notification): look up just those.
    if (newItems.length > 0) {
      newItems = await enrichNotifications(
        newItems,
        params.accessToken,
        params.refreshToken,
        params.onTokenRefresh,
      );
    }

    console.log(
      `[notif-watch] ${items.length} item(s), ${unreadCount} unread, ${newItems.length} new, ${Date.now() - startedAt}ms`,
    );
    return { items, newItems, unreadCount };
  })();

  inFlight = run;
  const clear = () => {
    if (inFlight === run) inFlight = null;
  };
  run.then(clear, clear);
  return run;
}

/**
 * System (OS) notifications — the ones that appear in the phone's
 * notification tray / lock screen, outside the app.
 *
 * These are LOCAL notifications raised by the app itself (expo-notifications)
 * after it finds new Liferay notifications — no push server is involved.
 * Not available on web or in Expo Go (only the in-app toast shows there).
 * expo-notifications is loaded lazily — see utils/optionalNativeModules.ts.
 */

import { Platform } from 'react-native';

import type { LiferayNotification } from './notificationService';
import { getNotificationText, getNotificationTitle } from '../utils/notificationContent';
import { loadNotificationsModule } from '../utils/optionalNativeModules';

/**
 * Android notification channel. A channel's importance is FIXED the first time it is created on a
 * phone (the app cannot raise it later, only the user can). The old id 'fuji-notifications' may
 * already exist on your phones with a low importance, which is exactly what makes notifications
 * arrive "silently" in the list instead of popping up at the top. A NEW id starts fresh at HIGH.
 * The same id must be in AndroidManifest.xml (firebase default_notification_channel_id) and, if the
 * Liferay push sets android.notification.channel_id, in the server payload.
 */
export const NOTIFICATION_CHANNEL_ID = 'fuji-alerts';
const LEGACY_CHANNEL_ID = 'fuji-notifications';

/** Data attached to every system notification, read when the user taps it. */
export const OPEN_NOTIFICATIONS_SCREEN = 'open-notifications';

/** Show at most this many separate system notifications per check; more become one summary. */
const MAX_INDIVIDUAL = 3;

/**
 * How a notification is presented while the app is OPEN: no OS banner (the
 * in-app toast already shows it), but it is still added to the tray.
 * When the app is in the background the OS shows it normally.
 * Call once at startup (module scope in App.tsx).
 */
export function configureNotificationPresentation(): void {
  const Notifications = loadNotificationsModule();
  if (!Notifications) return;
  // Create the channel NOW (not only after login) so a push that arrives first uses it.
  ensureAndroidChannel().catch(() => { });
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: false,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: true,
    }),
  });
}

let channelReady = false;

async function ensureAndroidChannel(): Promise<void> {
  const Notifications = loadNotificationsModule();
  if (!Notifications || Platform.OS !== 'android' || channelReady) return;
  const config = {
    name: 'Dispatch alerts',
    description: 'Dispatch, checkpoint and approval updates',
    importance: Notifications.AndroidImportance.HIGH, // HIGH = heads-up banner at the top
    sound: 'default',
    vibrationPattern: [0, 250, 150, 250],
    enableVibrate: true,
    enableLights: true,
    lightColor: '#0B5FA8',
    showBadge: true,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  };
  await Notifications.setNotificationChannelAsync(NOTIFICATION_CHANNEL_ID, config);
  // Keep the old channel too, in case the server payload still names it (new installs get it as HIGH).
  await Notifications.setNotificationChannelAsync(LEGACY_CHANNEL_ID, { ...config, name: 'Notifications' }).catch(() => { });
  channelReady = true;
  // Diagnostics: importance 4 (HIGH) or 5 (MAX) pops up at the top; 3 or lower is silent / no banner.
  try {
    const live = await Notifications.getNotificationChannelAsync(NOTIFICATION_CHANNEL_ID);
    console.log('[push] channel', NOTIFICATION_CHANNEL_ID, 'importance =', live?.importance, '(4 = pops up at the top)');
    const old = await Notifications.getNotificationChannelAsync(LEGACY_CHANNEL_ID);
    if (old && typeof old.importance === 'number' && old.importance < 4) {
      console.warn('[push] old channel', LEGACY_CHANNEL_ID, 'is stuck at importance', old.importance,
        '- anything the server sends to that channel will NOT pop up. Server must use', NOTIFICATION_CHANNEL_ID, 'or no channel id.');
    }
  } catch {
    // diagnostics only
  }
}

/**
 * Asks for notification permission (Android 13+ / iOS) the first time.
 * Returns true if system notifications can be shown.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  const Notifications = loadNotificationsModule();
  if (!Notifications) return false;
  try {
    await ensureAndroidChannel();
    const current = await Notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    const requested = await Notifications.requestPermissionsAsync();
    return requested.granted;
  } catch (err) {
    console.warn('[systemNotifications] permission check failed:', err);
    return false;
  }
}

/** Raises system notifications for newly arrived Liferay notifications. Never throws. */
export async function presentSystemNotifications(newItems: LiferayNotification[]): Promise<void> {
  const Notifications = loadNotificationsModule();
  if (!Notifications || newItems.length === 0) return;

  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    await ensureAndroidChannel();

    const trigger = Platform.OS === 'android' ? { channelId: NOTIFICATION_CHANNEL_ID } : null;

    if (newItems.length > MAX_INDIVIDUAL) {
      const latest = newItems[0];
      await Notifications.scheduleNotificationAsync({
        content: {
          title: `${newItems.length} new notifications`,
          body: `${getNotificationTitle(latest)}: ${getNotificationText(latest)}`,
          data: { action: OPEN_NOTIFICATIONS_SCREEN },
          sound: 'default',
        },
        trigger,
      });
      return;
    }

    for (const item of newItems) {
      await Notifications.scheduleNotificationAsync({
        identifier: `liferay-notification-${item.id}`, // same id never shows twice
        content: {
          title: getNotificationTitle(item),
          body: getNotificationText(item),
          data: { action: OPEN_NOTIFICATIONS_SCREEN, notificationId: item.id },
          sound: 'default',
        },
        trigger,
      });
    }
  } catch (err) {
    console.warn('[systemNotifications] could not show system notification:', err);
  }
}

/**
 * One local alert that is not a Liferay notification (e.g. "you are near the
 * destination" raised by the background GPS task). The same `id` replaces the
 * earlier alert instead of stacking a new one. Never throws.
 */
export async function presentLocalAlert(
  id: string,
  title: string,
  body: string,
  data: Record<string, unknown> = { action: OPEN_NOTIFICATIONS_SCREEN },
): Promise<void> {
  const Notifications = loadNotificationsModule();
  if (!Notifications) return;
  try {
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) return;
    await ensureAndroidChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: id,
      content: { title, body, data, sound: 'default' },
      trigger: Platform.OS === 'android' ? { channelId: NOTIFICATION_CHANNEL_ID } : null,
    });
  } catch (err) {
    console.warn('[systemNotifications] could not show local alert:', err);
  }
}

/** App icon badge = unread count (iOS, and Android launchers that support it). */
export async function setAppBadgeCount(count: number): Promise<void> {
  const Notifications = loadNotificationsModule();
  if (!Notifications) return;
  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {
    // not supported by this launcher
  }
}

/** Calls `onOpen` when the user taps one of our system notifications. Returns an unsubscribe function. */
export function onSystemNotificationTapped(onOpen: () => void): () => void {
  const Notifications = loadNotificationsModule();
  if (!Notifications) return () => {};

  const subscription = Notifications.addNotificationResponseReceivedListener((response: any) => {
    const data = response.notification.request.content.data as { action?: string } | undefined;
    if (data?.action === OPEN_NOTIFICATIONS_SCREEN) onOpen();
  });

  // App was launched by tapping a notification while it was closed.
  Notifications.getLastNotificationResponseAsync()
    .then((response: any) => {
      const data = response?.notification.request.content.data as { action?: string } | undefined;
      if (data?.action === OPEN_NOTIFICATIONS_SCREEN) onOpen();
    })
    .catch(() => {});

  return () => subscription.remove();
}

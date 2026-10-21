/**
 * Background check for new notifications (app in background or closed).
 *
 * Android (WorkManager) / iOS (BGTaskScheduler) wake the app roughly every
 * 15 minutes at best — the OS decides the exact timing, and it can be longer
 * on battery saver / Doze. When woken:
 *   1. read the saved session (refresh the access token if it is about to expire)
 *   2. fetch notifications and find new ones (notificationWatcher)
 *   3. raise a system notification for each new one + update the app icon badge
 *
 * This file must be imported once at app start (App.tsx) so the task is
 * defined before the OS tries to run it.
 *
 * Note: background tasks don't run in Expo Go or on web, and stop if the user
 * force-stops the app. Instant delivery while the app is closed needs server
 * push (FCM / APNs) instead. The native modules are loaded lazily (see
 * utils/optionalNativeModules.ts) so a build without them still starts.
 */

import { getAuthSession, saveAuthSession, clearAuthSession, StoredAuthSession } from '../services/sessionStorage';
import { getValidSession } from '../services/sessionTokenService';
import { checkForNewNotifications } from '../services/notificationWatcher';
import { presentSystemNotifications, setAppBadgeCount } from '../services/systemNotifications';
import { loadBackgroundTaskModule, loadTaskManagerModule } from '../utils/optionalNativeModules';

export const NOTIFICATION_TASK = 'fuji-notification-check';

/** Minutes between checks (the OS minimum is 15). */
const CHECK_INTERVAL_MINUTES = 15;

const TaskManager = loadTaskManagerModule();
const BackgroundTask = loadBackgroundTaskModule();

/**
 * One notification check: refresh the token if needed, fetch notifications,
 * raise a system (status-bar) notification for each new one and update the
 * badge. Throws on failure. Used by the 15-minute task below AND by the
 * background GPS task (tasks/backgroundGpsTask.ts), which calls it about once
 * a minute while a journey is active so alerts arrive much faster.
 */
export async function runBackgroundNotificationCheck(): Promise<void> {
  const saved = await getAuthSession();
  if (!saved) return; // signed out

  let session: StoredAuthSession;
  try {
    // Renews with the saved session's own refresh token if the access token is about to expire.
    session = await getValidSession(60_000);
  } catch {
    console.warn('[backgroundNotificationTask] Token renewal failed. Skipping background check.');
    return;
  }

  const { newItems, unreadCount } = await checkForNewNotifications({
    userId: session.user.id,
    accessToken: session.accessToken,
    refreshToken: session.refreshToken ?? '',
    onTokenRefresh: (accessToken, refreshToken, expiresAt) => {
      session = { ...session, accessToken, refreshToken, expiresAt };
      saveAuthSession(session).catch(() => { });
    },
    onSessionExpired: () => {
      clearAuthSession().catch(() => { });
    },
  });

  await presentSystemNotifications(newItems);
  await setAppBadgeCount(unreadCount);
}

if (TaskManager && BackgroundTask) {
  const { BackgroundTaskResult } = BackgroundTask;

  try {
    TaskManager.defineTask(NOTIFICATION_TASK, async () => {
      try {
        // Lazy require: backgroundGpsTask imports this file, so a top-level import would be circular.
        try {
          await require('./backgroundGpsTask').resumeBackgroundGpsIfNeeded();
        } catch {
          // never let the GPS watchdog break the notification check
        }
        await runBackgroundNotificationCheck();
        return BackgroundTaskResult.Success;
      } catch (err) {
        console.warn('[backgroundNotificationTask] failed:', err);
        return BackgroundTaskResult.Failed;
      }
    });
  } catch (err) {
    console.warn('[backgroundNotificationTask] could not define the task:', err);
  }
}

/** Starts the periodic background check (call after sign-in). Never throws. */
export async function registerBackgroundNotificationCheck(): Promise<void> {
  if (!TaskManager || !BackgroundTask) return;
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) {
      console.warn('[backgroundNotificationTask] background tasks are not available on this device');
      return;
    }
    await BackgroundTask.registerTaskAsync(NOTIFICATION_TASK, {
      minimumInterval: CHECK_INTERVAL_MINUTES,
    });
  } catch (err) {
    console.warn('[backgroundNotificationTask] register failed:', err);
  }
}

/** Stops the background check (call on logout). Never throws. */
export async function unregisterBackgroundNotificationCheck(): Promise<void> {
  if (!TaskManager || !BackgroundTask) return;
  try {
    if (await TaskManager.isTaskRegisteredAsync(NOTIFICATION_TASK)) {
      await BackgroundTask.unregisterTaskAsync(NOTIFICATION_TASK);
    }
  } catch (err) {
    console.warn('[backgroundNotificationTask] unregister failed:', err);
  }
}

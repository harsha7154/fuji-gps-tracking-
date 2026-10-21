/**
 * Safe, lazy access to the native modules used for system notifications and
 * the background notification check.
 *
 * Importing expo-notifications / expo-task-manager / expo-background-task at
 * the top of a file runs their native setup immediately. That breaks (red
 * error screen / "Cannot find native module") when the app runs in:
 *   - Expo Go (remote-notification support was removed from Expo Go; no
 *     background tasks), or
 *   - a development build made BEFORE these packages were installed.
 *
 * So they are only `require`d here, on demand, inside try/catch. When a module
 * can't be loaded the feature is simply skipped — the in-app toast still works.
 */
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

type NotificationsModule = any;
type TaskManagerModule = any;
type BackgroundTaskModule = any;

/** Running inside the Expo Go app (not a development / production build). */
export const isExpoGo =
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** System notifications + background tasks need a native dev/production build. */
export const nativeNotificationsSupported =
  (Platform.OS === 'android' || Platform.OS === 'ios') && !isExpoGo;

const cache: {
  notifications?: NotificationsModule | null;
  taskManager?: TaskManagerModule | null;
  backgroundTask?: BackgroundTaskModule | null;
} = {};

let explained = false;
function explainOnce(name: string, err: unknown) {
  if (explained) return;
  explained = true;
  console.warn(
    `[notifications] ${name} is not available in this build, so phone (system) notifications ` +
      'and the background check are turned off. The in-app toast still works. ' +
      'Rebuild the dev client after installing the packages (npx expo run:android / eas build).',
    err,
  );
}

export function loadNotificationsModule(): NotificationsModule | null {
  if (cache.notifications !== undefined) return cache.notifications;
  if (!nativeNotificationsSupported) return (cache.notifications = null);
  try {
    cache.notifications = require('expo-notifications') as NotificationsModule;
  } catch (err) {
    explainOnce('expo-notifications', err);
    cache.notifications = null;
  }
  return cache.notifications;
}

export function loadTaskManagerModule(): TaskManagerModule | null {
  if (cache.taskManager !== undefined) return cache.taskManager;
  if (!nativeNotificationsSupported) return (cache.taskManager = null);
  try {
    cache.taskManager = require('expo-task-manager') as TaskManagerModule;
  } catch (err) {
    explainOnce('expo-task-manager', err);
    cache.taskManager = null;
  }
  return cache.taskManager;
}

export function loadBackgroundTaskModule(): BackgroundTaskModule | null {
  if (cache.backgroundTask !== undefined) return cache.backgroundTask;
  if (!nativeNotificationsSupported) return (cache.backgroundTask = null);
  try {
    cache.backgroundTask = require('expo-background-task') as BackgroundTaskModule;
  } catch (err) {
    explainOnce('expo-background-task', err);
    cache.backgroundTask = null;
  }
  return cache.backgroundTask;
}

/**
 * Device settings chosen on the Settings screen (persisted, survive logout and app restarts).
 *
 *   backgroundNotifications  system notifications while the app is in the background / closed:
 *                            the 15-minute background check, notifications raised from the
 *                            background GPS service, and FCM pushes (the phone's push token is
 *                            removed from the server while this is off).
 *                            In-app notifications (bell badge, toast, Notifications screen) are NOT affected.
 *   backgroundGps            the background location service that keeps sending GPS pings while the
 *                            app is minimised / closed. Foreground tracking on the Live GPS screen is
 *                            NOT affected.
 *
 * Both default to ON (the behaviour before this setting existed). Background tasks run in their own
 * JS runtime, so every reader goes through getAppSettings(), which loads from storage when needed.
 */
import { appStorage } from './sessionStorage';

export interface AppSettings {
  backgroundNotifications: boolean;
  backgroundGps: boolean;
}

const SETTINGS_KEY = 'fuji_app_settings';

const DEFAULT_SETTINGS: AppSettings = {
  backgroundNotifications: true,
  backgroundGps: true,
};

let cached: AppSettings | null = null;
let loading: Promise<AppSettings> | null = null;
const listeners = new Set<(settings: AppSettings) => void>();

function parse(raw: string | null): AppSettings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const value = JSON.parse(raw) as Partial<AppSettings>;
    return {
      backgroundNotifications:
        typeof value.backgroundNotifications === 'boolean'
          ? value.backgroundNotifications
          : DEFAULT_SETTINGS.backgroundNotifications,
      backgroundGps: typeof value.backgroundGps === 'boolean' ? value.backgroundGps : DEFAULT_SETTINGS.backgroundGps,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/** Current settings (loaded once from storage, then from memory). Never throws. */
export function getAppSettings(): Promise<AppSettings> {
  if (cached) return Promise.resolve(cached);
  if (!loading) {
    loading = appStorage
      .getItem(SETTINGS_KEY)
      .then(parse)
      .catch((err) => {
        console.warn('[appSettings] could not read settings, using defaults:', err);
        return { ...DEFAULT_SETTINGS };
      })
      .then((settings) => {
        cached = settings;
        loading = null;
        return settings;
      });
  }
  return loading;
}

/** Last loaded settings, or null before the first load (screens use it for the first paint). */
export function peekAppSettings(): AppSettings | null {
  return cached;
}

/** Saves one setting and tells every subscriber. Throws if it could not be saved. */
export async function setAppSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<AppSettings> {
  const next: AppSettings = { ...(await getAppSettings()), [key]: value };
  await appStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  cached = next;
  listeners.forEach((listener) => {
    try {
      listener(next);
    } catch (err) {
      console.warn('[appSettings] listener failed:', err);
    }
  });
  return next;
}

/** Called after every change. Returns the unsubscribe function. */
export function subscribeAppSettings(listener: (settings: AppSettings) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export async function isBackgroundNotificationsEnabled(): Promise<boolean> {
  return (await getAppSettings()).backgroundNotifications;
}

export async function isBackgroundGpsEnabled(): Promise<boolean> {
  return (await getAppSettings()).backgroundGps;
}

/**
 * FCM push registration (Android) - Liferay sends the pushes, no relay server.
 *
 * HOW IT WORKS
 *   1. After sign-in the app asks Google for this phone's FCM token
 *      (expo-notifications -> getDevicePushTokenAsync; works because google-services.json
 *      is part of the build).
 *   2. The app saves that token on the driver's Liferay user account (fCMToken field):
 *        POST {LIFERAY}/o/mobile-auth/push-token   { "fcmToken": "<token>" }
 *        Authorization: Bearer <driver access token>
 *   3. Liferay (service-account key of the SAME Firebase project) sends the push to
 *      FCM using that token. Android shows it even if the app is closed.
 *   4. On logout the field is cleared so the next user of this phone does not get the
 *      previous driver's notifications.
 *
 *   ONE PHONE = ONE USER: the token is saved through
 *        POST {LIFERAY}/o/mobile-auth/push-token   { "fcmToken": "<token>" }
 *   which stores it on the signed-in user ONLY and removes the same token from every
 *   other user (left behind by a failed logout / user switch / expired session), so the
 *   phone receives the pushes of the signed-in user and nobody else's.
 *   There is NO fallback to PATCH /headless-admin-user/v1.0/user-accounts/{id}: on Liferay
 *   2026.q2 that PATCH (fCMToken is a User-object extension field) fails with
 *   "StaleStateException ... update User_ set mvccVersion=?, modifiedDate=?". A server
 *   without /push-token (404) simply gets no registration until the module is deployed.
 *
 * LOGS - filter the Metro / `adb logcat -s ReactNativeJS` output with  [push]
 *   [push] token ...        FCM token obtained from Google
 *   [push] STORED OK        Liferay saved the token on the signed-in user
 *   [push] RECEIVED (push)  an FCM message arrived while the app is OPEN
 *   [push] TAPPED           the user tapped a notification (push or local)
 *   [push] LAUNCHED BY TAP  the app was closed and was opened by tapping a notification
 *   Note: when the app is closed/background, Android shows the notification itself and NO JS
 *   runs, so nothing can be logged at that moment - the tap logs above prove it came from FCM.
 *
 * Every function is safe to call anywhere: never throws, returns false when push is
 * unavailable (web, Expo Go, iOS, offline...).
 */

import { AppState, Platform } from 'react-native';

import { getBaseUrl } from '../api/client';
import { loadNotificationsModule } from '../utils/optionalNativeModules';
import { appStorage } from './sessionStorage';
import { isBackgroundNotificationsEnabled } from './appSettings';

const STORED_KEY = 'fuji_push_registration';
/** Re-send the registration at least this often (heals a lost / overwritten token). */
const REREGISTER_EVERY_MS = 30 * 60 * 1000;
const RETRY_DELAYS_MS = [15_000, 60_000, 5 * 60_000];
const REQUEST_TIMEOUT_MS = 10_000;
const LOGOUT_TIMEOUT_MS = 4_000;

let lastOkAt = 0;
/** Always the CURRENT signed-in user + token, so a retry never reuses an expired access token. */
let latestAuthGetter: (() => PushAuth | null) | null = null;

// Listeners for "an FCM push arrived while the app is open" (badge / list refresh on demand).
const pushReceivedListeners = new Set<() => void>();

/** Called whenever an FCM push is received while the app is open. Returns the unsubscribe function. */
export function onPushReceived(listener: () => void): () => void {
  pushReceivedListeners.add(listener);
  return () => {
    pushReceivedListeners.delete(listener);
  };
}
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** Registration already running: callers share it instead of sending parallel requests. */
let inFlight: Promise<boolean> | null = null;

export interface PushAuth {
  userId: string;
  /** The driver's current Liferay access token. */
  accessToken: string;
}

interface StoredRegistration {
  fcmToken: string;
  userId: string;
}

const log = (...args: unknown[]) => console.log('[push]', ...args);
const warn = (...args: unknown[]) => console.warn('[push]', ...args);
const tail = (t: string) => `...${t.slice(-8)}`;

export function isPushConfigured(): boolean {
  return Platform.OS === 'android';
}

// ── Liferay call ─────────────────────────────────────────────────────────────

type ServerResult = 'ok' | 'unsupported' | 'failed';

/**
 * POST /o/mobile-auth/push-token - saves the token on this user only and removes it
 * from all other users. An empty token clears it (logout).
 */
async function saveOnServer(auth: PushAuth, fcmToken: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<ServerResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${getBaseUrl()}/o/mobile-auth/push-token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.accessToken}`,
      },
      body: JSON.stringify({ fcmToken }),
      signal: controller.signal,
    });
    if (res.status === 404 || res.status === 405) {
      warn(`push-token endpoint not on this server (HTTP ${res.status}) - deploy the anganwadi-rest module`);
      return 'unsupported';
    }
    const body: any = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      warn(`push-token refused, HTTP ${res.status}`, body?.error ?? '');
      return 'failed';
    }
    log(
      fcmToken
        ? `STORED OK - token ${tail(fcmToken)} is on user ${auth.userId} only` +
            (body.removedFromOtherUsers ? ` (removed from ${body.removedFromOtherUsers} other user(s))` : '')
        : `token cleared on user ${auth.userId}`,
    );
    return 'ok';
  } catch (err) {
    warn('push-token request failed (network?):', err);
    return 'failed';
  } finally {
    clearTimeout(timer);
  }
}

// ── FCM token ────────────────────────────────────────────────────────────────

async function getFcmToken(): Promise<string | null> {
  const Notifications = loadNotificationsModule();
  if (!Notifications) {
    warn('expo-notifications is not available in this build (Expo Go / web?) - no FCM token');
    return null;
  }
  try {
    const result = await Notifications.getDevicePushTokenAsync();
    const token = typeof result?.data === 'string' ? result.data : '';
    if (!token) {
      warn('getDevicePushTokenAsync returned an empty token');
      return null;
    }
    log(`token obtained from Google (length ${token.length}, ${tail(token)})`);
    // Full token only in dev builds: paste it in Firebase console > Cloud Messaging > "Send test message".
    if (__DEV__) log('FULL TOKEN (dev only):', token);
    return token;
  } catch (err) {
    // Typical cause: google-services.json was not part of this build.
    warn('could not get the FCM token (is google-services.json in this build?):', err);
    return null;
  }
}

async function readStored(): Promise<StoredRegistration | null> {
  try {
    const raw = await appStorage.getItem(STORED_KEY);
    return raw ? (JSON.parse(raw) as StoredRegistration) : null;
  } catch {
    return null;
  }
}

// ── public API ───────────────────────────────────────────────────────────────

/** Saves this phone's FCM token on the signed-in driver's Liferay account. Returns true on success. */
export async function registerForPush(auth: PushAuth, attempt = 0): Promise<boolean> {
  // Settings > Background Notifications OFF: this phone must not get pushes (they show while the app is closed).
  if (!(await isBackgroundNotificationsEnabled())) {
    log('registration skipped: Background Notifications is off in Settings');
    return false;
  }
  if (inFlight) return inFlight;
  inFlight = registerOnce(auth).finally(() => {
    inFlight = null;
  });
  const ok = await inFlight;
  if (ok) {
    lastOkAt = Date.now();
    return true;
  }
  if (isPushConfigured() && attempt < RETRY_DELAYS_MS.length) {
    log(`registration failed - retry ${attempt + 1}/${RETRY_DELAYS_MS.length} in ${RETRY_DELAYS_MS[attempt] / 1000}s`);
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(() => {
      // Use the freshest token (the one passed at sign-in may have expired during the wait).
      const fresh = latestAuthGetter?.() ?? auth;
      registerForPush(fresh, attempt + 1).catch(() => { });
    }, RETRY_DELAYS_MS[attempt]);
  }
  return false;
}

async function registerOnce(auth: PushAuth): Promise<boolean> {
  if (!isPushConfigured()) return false;
  if (!auth.userId || !auth.accessToken) {
    warn('registration skipped: no signed-in user / access token yet');
    return false;
  }
  try {
    log(`registering phone for user ${auth.userId}...`);
    const fcmToken = await getFcmToken();
    if (!fcmToken) return false;

    const server = await saveOnServer(auth, fcmToken);
    if (server === 'ok') {
      await appStorage.setItem(STORED_KEY, JSON.stringify({ fcmToken, userId: auth.userId } satisfies StoredRegistration));
      return true;
    }
    return false;
  } catch (err) {
    warn('registration failed (network?):', err);
    return false;
  }
}

/**
 * Settings > Background Notifications changed: register this phone for pushes again (ON) or remove
 * its token from the server (OFF) for the signed-in user. Never throws.
 */
export async function setBackgroundPushEnabled(enabled: boolean): Promise<void> {
  const auth = latestAuthGetter?.() ?? null;
  if (!auth) return;
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (enabled) {
    await registerForPush(auth).catch(() => false);
  } else {
    lastOkAt = 0;
    await unregisterFromPush(auth);
  }
}

/**
 * Logout: clear the token on Liferay so this phone stops receiving the driver's pushes.
 * Call BEFORE the session is cleared and pass the current auth. Never throws, gives up after 4 s.
 */
export async function unregisterFromPush(auth: PushAuth | null): Promise<void> {
  if (!isPushConfigured()) return;
  try {
    const stored = await readStored();
    await appStorage.removeItem(STORED_KEY).catch(() => { });
    if (!stored) {
      log('logout: nothing registered on this phone');
      return;
    }
    if (!auth?.accessToken) {
      warn('logout: no access token, cannot clear the token on Liferay');
      return;
    }
    log(`logout: clearing token ${tail(stored.fcmToken)} on user ${auth.userId}`);
    await saveOnServer(auth, '', LOGOUT_TIMEOUT_MS);
  } catch (err) {
    warn('logout: could not clear the token (Liferay should drop dead tokens when FCM reports them):', err);
  }
}

function describe(notification: any) {
  const req = notification?.request;
  return {
    id: req?.identifier,
    source: req?.trigger?.type === 'push' ? 'FCM push' : 'local alert',
    title: req?.content?.title,
    body: req?.content?.body,
    data: req?.content?.data,
  };
}

/**
 * Keeps the registration healthy and logs everything FCM-related while signed in:
 *  - token refreshed by Google -> save the new one
 *  - app back in the foreground -> re-register if the last success is old / failed
 *  - push received while the app is open, notification tapped, app launched by a tap
 * `getAuth` returns the CURRENT signed-in driver (or null). Returns an unsubscribe function.
 */
export function watchPushTokenChanges(getAuth: () => PushAuth | null): () => void {
  if (!isPushConfigured()) return () => { };
  const Notifications = loadNotificationsModule();
  if (!Notifications) return () => { };

  latestAuthGetter = getAuth;
  const tokenSub = Notifications.addPushTokenListener((t: any) => {
    log('Google issued a NEW FCM token', typeof t?.data === 'string' ? tail(t.data) : '');
    const auth = getAuth();
    if (auth) registerForPush(auth).catch(() => { });
  });

  const receivedSub = Notifications.addNotificationReceivedListener((n: any) => {
    const d = describe(n);
    log(d.source === 'FCM push' ? 'RECEIVED (push) while app is open' : 'received (local alert) while app is open', d);
    // Only a real push means "something new on the server" (local alerts are raised by the app itself).
    if (d.source === 'FCM push') {
      pushReceivedListeners.forEach((listener) => {
        try {
          listener();
        } catch (err) {
          warn('push listener failed:', err);
        }
      });
    }
  });

  const responseSub = Notifications.addNotificationResponseReceivedListener((r: any) => {
    log('TAPPED', describe(r?.notification));
  });

  Notifications.getLastNotificationResponseAsync()
    .then((r: any) => {
      if (r) log('LAUNCHED BY TAP - the app was opened from a notification', describe(r.notification));
    })
    .catch(() => { });

  const appState = AppState.addEventListener('change', (state: string) => {
    if (state !== 'active' || Date.now() - lastOkAt < REREGISTER_EVERY_MS) return;
    const auth = getAuth();
    if (auth) registerForPush(auth).catch(() => { });
  });

  return () => {
    tokenSub.remove();
    receivedSub.remove();
    responseSub.remove();
    appState.remove();
    if (retryTimer) clearTimeout(retryTimer);
    if (latestAuthGetter === getAuth) latestAuthGetter = null;
  };
}

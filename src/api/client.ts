/**
 * API client for the Liferay Headless API.
 *
 * Talks to:
 *   1. POST {BASE_URL}/o/mobile-auth/refresh-token
 *      -> renews an OTP login session (see refreshViaMobileAuth)
 *
 *   2. GET/POST dispatch, GPS and notification APIs using the driver's access token
 *      -> requestWithTokenRefresh automatically renews the token on HTTP 401
 *
 * Login itself (send-otp / verify-otp) lives in services/authService.ts.
 * No OAuth2 client id / client secret is used or shipped inside the app.
 */

import Constants from 'expo-constants';
import { Platform } from 'react-native';

// Expo only inlines EXPO_PUBLIC_* variables at bundle time when they are
// referenced with static member expressions.
const STATIC_ENV: Record<string, string | undefined> = {
  EXPO_PUBLIC_GOOGLE_MAPS_API_KEY:
    process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY,

  EXPO_PUBLIC_GPS_GATEWAY_URL:
    process.env.EXPO_PUBLIC_GPS_GATEWAY_URL,

  EXPO_PUBLIC_GPS_WS_URL:
    process.env.EXPO_PUBLIC_GPS_WS_URL,

  EXPO_PUBLIC_GPS_HTTP_URL:
    process.env.EXPO_PUBLIC_GPS_HTTP_URL,

  EXPO_PUBLIC_LIFERAY_BASE_URL:
    process.env.EXPO_PUBLIC_LIFERAY_BASE_URL,
};

function readConfig(key: string, fallback: string): string {
  return (
    (Constants.expoConfig?.extra as Record<string, string> | undefined)?.[
    key
    ] ??
    STATIC_ENV[key] ??
    (process.env as Record<string, string | undefined>)[key] ??
    fallback
  );
}

// Dev-server defaults
const LIFERAY_BASE_URL = readConfig(
  'EXPO_PUBLIC_LIFERAY_BASE_URL',
  'https://13.233.171.171:8443/',
).replace(/\/+$/, '');

/**
 * Refresh endpoint for OTP logins. The refresh_token returned by /o/mobile-auth/verify-otp is NOT a
 * Liferay OAuth2 refresh token (the standard /o/oauth2/token answers it with HTTP 400 invalid_grant),
 * so it is exchanged here instead. Override with EXPO_PUBLIC_MOBILE_REFRESH_PATH if the backend changes.
 */
const MOBILE_REFRESH_PATH = readConfig(
  'EXPO_PUBLIC_MOBILE_REFRESH_PATH',
  '/o/mobile-auth/refresh-token',
);

const DEFAULT_TIMEOUT_MS = 15000;

export function getBaseUrl(): string {
  if (__DEV__) {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      return `${window.location.origin}/__api_proxy__`;
    }

    const hostUri =
      Constants.expoConfig?.hostUri ??
      (Constants.manifest as any)?.debuggerHost;

    if (hostUri) {
      const [ip, port] = hostUri.split(':');

      return `http://${ip}:${port || '8081'}/__api_proxy__`;
    }
  }

  return LIFERAY_BASE_URL;
}

/**
 * Standalone GPS WebSocket service (Redis-backed, no Liferay dependency).
 *
 *   gpsWs   = ws://<host>:8070    -> /ws/gps/mobile/{dispatchId}
 *   gpsHttp = http://<host>:8070  -> /health
 *
 * Override with EXPO_PUBLIC_GPS_WS_URL / EXPO_PUBLIC_GPS_HTTP_URL. Otherwise
 * the host is taken from EXPO_PUBLIC_LIFERAY_BASE_URL (the REAL server, not
 * the Metro dev proxy — the WebSocket always talks to the server directly).
 */
const GPS_SERVICE_PORT = 8070;

function liferayHost(): string {
  const match = LIFERAY_BASE_URL.match(/^[a-z]+:\/\/([^:/]+)/i);
  return match ? match[1] : 'localhost';
}

export function getGpsWsUrl(): string {
  const env = readConfig('EXPO_PUBLIC_GPS_WS_URL', '');
  if (env) return env.replace(/\/+$/, '');
  return `ws://${liferayHost()}:${GPS_SERVICE_PORT}`;
}

export function getGpsHttpUrl(): string {
  const env = readConfig('EXPO_PUBLIC_GPS_HTTP_URL', '');
  if (env) return env.replace(/\/+$/, '');
  return `http://${liferayHost()}:${GPS_SERVICE_PORT}`;
}

// Google Maps Platform API key.
export function getGoogleMapsApiKey(): string {
  return readConfig(
    'EXPO_PUBLIC_GOOGLE_MAPS_API_KEY',
    '',
  );
}

export class ApiClientNotConfiguredError extends Error {
  constructor() {
    super(
      'Liferay API base URL is not configured.',
    );

    this.name =
      'ApiClientNotConfiguredError';
  }
}

/**
 * API timing log. ONE greppable tag:  [API]
 *
 *   adb logcat -s ReactNativeJS:V | grep "\[API\]"
 *   (PowerShell)  adb logcat -s ReactNativeJS:V | Select-String "\[API\]"
 *
 * One line per request:   [API] GET /o/material-dispatch-rest/dispatches 200 412ms
 *   - SLOW   : answered, but took >= SLOW_API_MS (warn)
 *   - FAILED : timeout / network error / aborted (warn)
 * Only the path is logged (no query values, no tokens). Set API_LOGGING_ENABLED = false to silence.
 */
export const API_LOGGING_ENABLED = true;
const SLOW_API_MS = 2000;
/** Frequent background calls: logged only when slow or failed. */
const QUIET_API_PATHS = ['/o/gps/live', '/health'];

function describeRequest(input: string, init: RequestInit): string {
  const method = (init.method ?? 'GET').toUpperCase();
  const path = String(input).replace(/^[a-z]+:\/\/[^/]+/i, '').split('?')[0];
  return `${method} ${path}`;
}

function logApiResult(label: string, status: number, ms: number): void {
  if (!API_LOGGING_ENABLED) return;
  if (ms >= SLOW_API_MS) {
    console.warn(`[API] SLOW ${label} ${status} ${ms}ms`);
  } else if (!QUIET_API_PATHS.some((p) => label.includes(p))) {
    console.log(`[API] ${label} ${status} ${ms}ms`);
  }
}

function logApiFailure(label: string, reason: string): void {
  if (!API_LOGGING_ENABLED) return;
  console.warn(`[API] FAILED ${label} - ${reason}`);
}

/**
 * fetch() with a timeout that really cancels the request.
 *
 * The previous helper raced fetch() against a timer: the caller stopped waiting, but the native
 * request kept running and kept its connection busy, so later requests queued behind it.
 * Here the timer aborts the request through an AbortController.
 *
 * - Timeout:      rejects with Error(timeoutMessage) - 'TIMEOUT' by default, same as before.
 * - Caller abort: if init.signal is aborted, rejects with that AbortError (not a timeout).
 * - Like before, the timer covers the request until the response arrives, not the body read.
 */
export async function fetchWithTimeout(
  input: string,
  init: RequestInit = {},
  ms: number = DEFAULT_TIMEOUT_MS,
  timeoutMessage = 'TIMEOUT',
): Promise<Response> {
  const controller = new AbortController();
  const callerSignal = init.signal ?? undefined;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onCallerAbort);
  }

  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);

  const startedAt = Date.now();
  const label = describeRequest(input, init);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    logApiResult(label, response.status, Date.now() - startedAt);
    return response;
  } catch (err) {
    const elapsed = Date.now() - startedAt;
    if (timedOut) {
      logApiFailure(label, `TIMEOUT after ${elapsed}ms`);
      throw new Error(timeoutMessage);
    }
    logApiFailure(label, `${err instanceof Error ? err.message : String(err)} after ${elapsed}ms`);
    throw err;
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

async function throwForBadResponse(
  response: Response,
): Promise<never> {
  let body: unknown;

  try {
    body = await response.json();
  } catch {
    // Response wasn't JSON.
  }

  const error = new Error(
    `Request failed with status ${response.status}`,
  );

  (error as any).status =
    response.status;

  (error as any).body = body;

  throw error;
}

/**
 * Raw shape of the Liferay OAuth2 token response.
 */
export interface LiferayTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;

  /**
   * Liferay normally returns refresh_token.
   *
   * refreshToken is also supported because some parts of the
   * application already handle both naming conventions.
   */
  refresh_token?: string;
  refreshToken?: string;
}

/**
 * OTP refresh tokens look like base64("<userId>:<id>:<expiryMs>:<secret>") + "." + signature.
 * Password-login refresh tokens (standard Liferay OAuth2) are opaque strings and never match.
 */
export function isMobileAuthRefreshToken(token: string): boolean {
  try {
    const head = String(token).split('.')[0];
    if (!head || typeof atob !== 'function') return false;
    const b64 = head.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    return /^\d+:\d+:\d{10,}:/.test(decoded);
  } catch {
    return false;
  }
}

/**
 * Refresh an OTP session.
 *
 * POST {BASE_URL}/o/mobile-auth/refresh-token
 * Body: { "refresh_token": "<saved refresh token>" }
 * Reply: { access_token, refresh_token (new), expires_in? }  (camelCase names are accepted too)
 *
 * HTTP 400/401 keep their status (and the server's JSON body) on the thrown error so the app can
 * end the session and show the server's reason.
 */
async function refreshViaMobileAuth(refreshToken: string): Promise<LiferayTokenResponse> {
  const response = await fetchWithTimeout(`${getBaseUrl()}${MOBILE_REFRESH_PATH}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    }, DEFAULT_TIMEOUT_MS);

  if (!response.ok) {
    await throwForBadResponse(response);
  }

  const raw: any = await response.json().catch(() => null);
  const accessToken = raw?.access_token ?? raw?.accessToken;
  if (!accessToken) {
    throw new Error('Refresh response did not contain an access token');
  }
  const expiresIn = Number(raw?.expires_in ?? raw?.expiresIn);
  return {
    access_token: accessToken,
    refresh_token: raw?.refresh_token ?? raw?.refreshToken,
    // Left undefined when the server omits it; computeExpiresAt() then reads the JWT exp claim.
    expires_in: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : (undefined as unknown as number),
    token_type: raw?.token_type ?? raw?.tokenType ?? 'Bearer',
    scope: raw?.scope ?? '',
  };
}

/**
 * Exchange a refresh token for a new access token.
 *
 * Only OTP sessions (/o/mobile-auth/refresh-token) can be renewed. A refresh token that is not an
 * OTP token (for example one saved by the old username/password login, which no longer exists) cannot be
 * renewed, so the caller ends the session and the driver signs in again with OTP.
 */
export async function refreshAccessToken(
  refreshToken: string,
): Promise<LiferayTokenResponse> {
  if (refreshToken && isMobileAuthRefreshToken(refreshToken)) {
    console.log(`[auth] refresh: OTP session -> POST ${MOBILE_REFRESH_PATH}`);
    return refreshViaMobileAuth(refreshToken);
  }
  console.log('[auth] refresh: not an OTP refresh token -> sign-in required');
  throw new SessionExpiredError(
    'This session cannot be renewed. Please sign in again with your mobile number.',
  );
}

/**
 * Renews the signed-in user's session with THEIR refresh token.
 *
 * - Never falls back to client_credentials. That grant is a shared service account (the "test
 *   user"); using it made calls such as /my-user-account and /my-user-notifications answer as
 *   that account instead of the driver. No refresh token / refresh rejected -> the caller must
 *   send the user back to the login screen.
 * - Refresh tokens can rotate. The proactive timer and a 401 retry can run at the same moment, so
 *   renewals are single-flight (one network call shared by all callers) and rotation-aware (an old
 *   token is mapped to its successor, and a renewal finished in the last 20 s is reused).
 *
 * LOGS: filter with  [auth]
 */
const REUSE_RENEWAL_MS = 20_000;
const rotatedRefreshTokens = new Map<string, string>();
let renewalInFlight: { key: string; promise: Promise<LiferayTokenResponse> } | null = null;
let lastRenewal: { tokens: Set<string>; data: LiferayTokenResponse; at: number } | null = null;

const tokenTail = (t: string) => `...${t.slice(-6)}`;

function latestRefreshToken(token: string): string {
  let current = token;
  for (let i = 0; i < 10 && rotatedRefreshTokens.has(current); i += 1) {
    current = rotatedRefreshTokens.get(current) as string;
  }
  return current;
}

/** Forget renewal state (called on logout / session end so the next user starts clean). */
export function resetRenewalState(): void {
  rotatedRefreshTokens.clear();
  renewalInFlight = null;
  lastRenewal = null;
}

/**
 * When does a freshly issued access token expire? Uses `expires_in` (seconds) from the token
 * response; if the server omitted it, reads the JWT `exp` claim; as a last resort assumes 10 minutes.
 * (A missing `expires_in` used to produce an "Invalid time value" crash right after a successful
 * renewal, which left the app holding an old token.)
 */
export function computeExpiresAt(
  data: { expires_in?: unknown; access_token?: string },
  nowMs: number = Date.now(),
): string {
  const seconds = Number(data?.expires_in);
  if (Number.isFinite(seconds) && seconds > 0) {
    return new Date(nowMs + seconds * 1000).toISOString();
  }
  try {
    const payload = String(data?.access_token ?? '').split('.')[1];
    if (payload) {
      const b64 = payload.replace(/-/g, '+').replace(/_/g, '/');
      const json = typeof atob === 'function' ? atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4)) : '';
      const exp = Number(JSON.parse(json)?.exp);
      if (Number.isFinite(exp) && exp * 1000 > nowMs) {
        return new Date(exp * 1000).toISOString();
      }
    }
  } catch {
    /* not a JWT */
  }
  console.warn('[auth] token response has no usable expires_in / exp - assuming 10 minutes');
  return new Date(nowMs + 10 * 60 * 1000).toISOString();
}

/** The most recent renewal failure, so the screen can show WHY a session ended. */
let lastAuthFailure: { at: number; text: string } | null = null;

/** e.g. "HTTP 400 invalid_grant: refresh token expired". Null if there was no recent failure. */
export function getLastAuthFailure(maxAgeMs = 5 * 60 * 1000): string | null {
  return lastAuthFailure && Date.now() - lastAuthFailure.at < maxAgeMs ? lastAuthFailure.text : null;
}

/**
 * True when the server ANSWERED the refresh request with a definite "no" (HTTP 400/401/403/404, for any
 * reason: invalid_grant, unsupported_grant_type, invalid_client, endpoint not found ...) or there is no refresh token.
 * Renewal cannot work in that state, so the session ends - with the server's reason shown - instead of
 * limping on with an expired token. Network errors, timeouts and 5xx return false: the saved session
 * is kept and renewal is retried.
 */
export function isRefreshRejected(err: unknown): boolean {
  if (err instanceof SessionExpiredError || (err as any)?.isSessionExpired === true) return true;
  const status = (err as any)?.status;
  // 403 / 404: not allowed / endpoint not found - renewal cannot work either.
  return status === 400 || status === 401 || status === 403 || status === 404;
}

export async function renewSessionToken(
  refreshToken?: string,
): Promise<LiferayTokenResponse> {
  const trimmed = (refreshToken ?? '').trim();
  if (!trimmed) {
    console.warn(
      '[auth] renew: this session has no refresh token -> sign-in required (client_credentials is NOT used for user sessions)',
    );
    lastAuthFailure = { at: Date.now(), text: 'no refresh token saved for this login' };
    throw new SessionExpiredError(
      'This session has no refresh token. Please sign in again.',
    );
  }

  // A renewal that just finished already covers this caller.
  if (
    lastRenewal &&
    Date.now() - lastRenewal.at < REUSE_RENEWAL_MS &&
    lastRenewal.tokens.has(trimmed)
  ) {
    console.log('[auth] renew: reusing the renewal that just completed');
    return lastRenewal.data;
  }

  const key = latestRefreshToken(trimmed);
  if (renewalInFlight && renewalInFlight.key === key) {
    console.log('[auth] renew: joining the renewal already in progress');
    return renewalInFlight.promise;
  }

  console.log(`[auth] renew: refresh_token grant (refresh token ${tokenTail(key)})`);
  const promise = (async () => {
    try {
      const data = await refreshAccessToken(key);
      const next = data.refresh_token ?? data.refreshToken;
      const rotated = !!next && next !== key;
      if (rotated) {
        if (rotatedRefreshTokens.size > 20) rotatedRefreshTokens.clear();
        rotatedRefreshTokens.set(key, next as string);
      }
      lastRenewal = { tokens: new Set([trimmed, key]), data, at: Date.now() };
      lastAuthFailure = null;
      console.log(
        `[auth] renew OK: new access token valid ${data.expires_in}s, refresh token ${rotated ? 'ROTATED' : 'unchanged'}`,
      );
      return data;
    } catch (err) {
      const status = (err as any)?.status;
      const body = (err as any)?.body;
      const detail = body?.error
        ? ` ${body.error}${body.error_description ? ": " + body.error_description : ''}`
        : '';
      console.warn(
        `[auth] renew FAILED${status ? ` (HTTP ${status}${detail})` : ''}:`,
        err instanceof Error ? err.message : err,
      );
      lastAuthFailure = {
        at: Date.now(),
        text: status
          ? `HTTP ${status}${detail}`
          : err instanceof Error
            ? err.message
            : 'renewal failed',
      };
      throw err;
    }
  })();
  renewalInFlight = { key, promise };
  promise
    .then(() => undefined, () => undefined)
    .then(() => {
      if (renewalInFlight?.promise === promise) renewalInFlight = null;
    });
  return promise;
}

/**
 * Result returned by requestWithTokenRefresh.
 */
export interface RequestWithTokenRefreshResult {
  response: Response;
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
}

/**
 * Thrown when an access token is expired or unauthorized (401)
 * and cannot be refreshed (e.g. missing or rejected refresh token).
 */
export class SessionExpiredError extends Error {
  readonly isSessionExpired = true;

  constructor(
    message = 'Authentication session has expired and cannot be refreshed.',
  ) {
    super(message);
    this.name = 'SessionExpiredError';
  }
}

function toPlainHeaders(headers?: HeadersInit): Record<string, string> {
  const result: Record<string, string> = {};
  if (!headers) return result;

  if (typeof Headers !== 'undefined' && headers instanceof Headers) {
    headers.forEach((value, key) => {
      result[key] = value;
    });
  } else if (Array.isArray(headers)) {
    headers.forEach(([key, value]) => {
      result[key] = value;
    });
  } else if (typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (typeof value === 'string') {
        result[key] = value;
      }
    }
  }

  return result;
}

/**
 * Performs an authenticated API request.
 *
 * Flow:
 *
 * 1. Send request using current access token with plain Record<string, string> headers.
 *
 * 2. If response is NOT 401:
 *       return response normally.
 *
 * 3. If response is 401:
 *       - If no refresh token available: trigger onSessionExpired and throw SessionExpiredError.
 *       - If refresh token available: refresh access token. If refresh fails with 400/401, trigger onSessionExpired.
 *
 * 4. Retry the original request ONCE with the new access token.
 *       (If retry still returns 401, return response cleanly without further retries).
 *
 * 5. Notify the caller using onTokenRefresh().
 */
export async function requestWithTokenRefresh(
  url: string,
  accessToken: string,
  refreshToken?: string,
  options: RequestInit = {},
  onTokenRefresh?: (
    newAccessToken: string,
    newRefreshToken: string,
    newExpiresAt: string,
  ) => void,
  onSessionExpired?: () => void,
): Promise<RequestWithTokenRefreshResult> {
  const requestHeaders = toPlainHeaders(options.headers);

  if (accessToken && accessToken.trim()) {
    requestHeaders['Authorization'] = `Bearer ${accessToken.trim()}`;
  }

  let response = await fetchWithTimeout(url, {
      ...options,
      headers: requestHeaders,
    }, DEFAULT_TIMEOUT_MS);

  /**
   * Access token still valid or non-401 response.
   */
  if (response.status !== 401) {
    return {
      response,
      accessToken,
      refreshToken: refreshToken ?? '',
      expiresAt: '',
    };
  }

  const trimmedRefreshToken = (refreshToken ?? '').trim();
  console.log(
    '[apiClient] Access token expired or unauthorized (401). Renewing session token...',
  );

  let refreshed: LiferayTokenResponse;
  try {
    refreshed = await renewSessionToken(trimmedRefreshToken);
  } catch (refreshErr) {
    const status = (refreshErr as any)?.status;
    console.warn(
      `[apiClient] Session token renewal failed${status ? ` (status ${status})` : ''}:`,
      refreshErr,
    );
    if (
      refreshErr instanceof SessionExpiredError ||
      status === 400 ||
      status === 401 ||
      (refreshErr instanceof Error &&
        (refreshErr.message.includes('Refresh token is missing') ||
          refreshErr.message.includes('invalid_grant') ||
          refreshErr.message.includes('unauthorized_client')))
    ) {
      if (onSessionExpired) {
        onSessionExpired();
      }
      throw new SessionExpiredError(
        'Authentication session has expired and cannot be renewed.',
      );
    }
    throw refreshErr;
  }

  const newAccessToken = refreshed.access_token;

  /**
   * OAuth servers may rotate refresh tokens.
   * If no new refresh token is returned, continue using the existing one.
   */
  const newRefreshToken =
    refreshed.refresh_token ??
    refreshed.refreshToken ??
    trimmedRefreshToken;

  const newExpiresAt = computeExpiresAt(refreshed);

  /**
   * Inform AppNavigator / parent session.
   */
  if (onTokenRefresh) {
    onTokenRefresh(
      newAccessToken,
      newRefreshToken,
      newExpiresAt,
    );
  }

  /**
   * Retry the original request ONCE with the newly refreshed access token.
   */
  const retryHeaders = toPlainHeaders(options.headers);
  if (newAccessToken && newAccessToken.trim()) {
    retryHeaders['Authorization'] = `Bearer ${newAccessToken.trim()}`;
  }

  response = await fetchWithTimeout(url, {
      ...options,
      headers: retryHeaders,
    }, DEFAULT_TIMEOUT_MS);

  if (response.status === 401) {
    console.warn(
      `[apiClient] Request returned 401 even after token refresh: ${url}.`,
    );
  }

  return {
    response,
    accessToken: newAccessToken,
    refreshToken: newRefreshToken,
    expiresAt: newExpiresAt,
  };
}

/**
 * Exported API client.
 */
export const apiClient = {
  refreshAccessToken,

  renewSessionToken,

  resetRenewalState,

  computeExpiresAt,

  getLastAuthFailure,

  isConfigured: (): boolean =>
    Boolean(LIFERAY_BASE_URL),

  baseUrl: LIFERAY_BASE_URL,

  getBaseUrl,

  getGpsWsUrl,

  getGpsHttpUrl,

  getGoogleMapsApiKey,
};
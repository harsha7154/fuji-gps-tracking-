/**
 * sessionTokenService - the ONE place for code that has no React state (background tasks,
 * upload services, ...) to get a valid access token for the signed-in user.
 *
 * WHY
 *   - The refresh token is never a constant. It is read from the saved session on every call and
 *     the newest one (servers may rotate it on each refresh) is written back, so it is always current.
 *   - A refresh is ONLY ever done with that user's refresh token. The old fallback to the OAuth
 *     "client_credentials" grant (a shared service account, the "test user") is gone.
 *   - If the refresh token is missing/rejected, the saved session is cleared and listeners
 *     (AppNavigator) are told, so the app returns to the login screen instead of running as someone else.
 *   - A network failure does NOT end the session; the error is thrown and the caller can retry later.
 *
 * USAGE
 *   const session = await getValidSession();        // renews only if the token is about to expire
 *   fetch(url, { headers: { Authorization: `Bearer ${session.accessToken}` } });
 *
 * LOGS: filter with  [auth]
 */


import { apiClient, isRefreshRejected, SessionExpiredError } from '../api/client';
import {
  clearAuthSession,
  getAuthSession,
  saveAuthSession,
  StoredAuthSession,
} from './sessionStorage';

type Listener = () => void;
const listeners = new Set<Listener>();

/** Called when the session can no longer be renewed (the user must sign in again). Returns an unsubscribe fn. */
export function subscribeSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

async function endSession(reason: string): Promise<void> {
  console.warn(`[auth] session ended: ${reason}`);
  await clearAuthSession().catch(() => { });
  apiClient.resetRenewalState();
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      /* a listener must never break the caller */
    }
  });
}

/** Renews the saved session with ITS OWN refresh token and saves the result. */
export async function refreshStoredSession(): Promise<StoredAuthSession> {
  const session = await getAuthSession();
  if (!session) {
    throw new SessionExpiredError('No saved session. Please sign in.');
  }
  try {
    const renewed = await apiClient.renewSessionToken(session.refreshToken);
    // Re-read: another caller may have saved a newer session while this request was running.
    const latest = (await getAuthSession()) ?? session;
    const next: StoredAuthSession = {
      ...latest,
      accessToken: renewed.access_token,
      refreshToken:
        renewed.refresh_token ?? renewed.refreshToken ?? latest.refreshToken ?? session.refreshToken,
      expiresAt: apiClient.computeExpiresAt(renewed),
    };
    await saveAuthSession(next);
    return next;
  } catch (err) {
    if (isRefreshRejected(err)) {
      await endSession(err instanceof Error ? err.message : 'refresh rejected');
      throw err instanceof SessionExpiredError
        ? err
        : new SessionExpiredError('Your session has expired. Please sign in again.');
    }
    console.warn('[auth] renewal failed but the server did not refuse the refresh token (network/config?) - session kept, will retry:', err);
    throw err;
  }
}

/** Returns a session whose access token stays valid for at least `minValidityMs`, renewing if needed. */
export async function getValidSession(minValidityMs = 60_000): Promise<StoredAuthSession> {
  const session = await getAuthSession();
  if (!session) {
    throw new SessionExpiredError('No saved session. Please sign in.');
  }
  const expiresMs = Date.parse(session.expiresAt);
  if (Number.isFinite(expiresMs) && expiresMs - Date.now() > minValidityMs) {
    return session;
  }
  return refreshStoredSession();
}

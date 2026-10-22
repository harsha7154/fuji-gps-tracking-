/**
 * App-wide React Query client + helpers.
 *
 * ONE cache for every screen and every background component:
 *  - cached by key  (a screen you come back to paints instantly from the cache),
 *  - de-duplicated  (many callers asking for the same key at once = ONE network request),
 *  - stale-while-revalidate (data younger than `staleTime` is reused, older data is shown AND refreshed),
 *  - garbage-collected after 30 min unused.
 * The cache lives in memory only and is cleared on logout (see clearAuthSession).
 */
import { AppState, Platform } from 'react-native';
import { focusManager, QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10_000,
      gcTime: 30 * 60_000,
      retry: 1,
      retryDelay: 1_000,
      refetchOnReconnect: true,
      refetchOnWindowFocus: true,
    },
  },
});

// React Native has no browser "window focus": treat "app in the foreground" as focus.
// This is what pauses polling while the app is in the background and refreshes stale data when it returns.
if (Platform.OS !== 'web') {
  focusManager.setEventListener((handleFocus) => {
    const sub = AppState.addEventListener('change', (state) => handleFocus(state === 'active'));
    return () => sub.remove();
  });
}

type Id = string | number;

/** Query keys. Always include the user id so one driver's data can never be shown to another. */
export const qk = {
  dashboard: (userId: Id) => ['dashboard', String(userId)] as const,
  active: (userId: Id) => ['active-dispatch', String(userId)] as const,
  trip: (userId: Id, dispatchId?: string) => ['trip', String(userId), dispatchId ?? 'current'] as const,
  history: (userId: Id) => ['trip-history', String(userId)] as const,
  profile: (userId: Id) => ['profile', String(userId)] as const,
  notifications: () => ['notifications', 'me'] as const,
  activities: (userId: Id) => ['activities', String(userId)] as const,
};

/** Cached value or undefined. No network. */
export function peekQuery<T>(key: readonly unknown[]): T | undefined {
  return queryClient.getQueryData<T>(key);
}

/** Data younger than `staleTime` comes from the cache; otherwise ONE shared request is made. */
export function fetchCached<T>(key: readonly unknown[], fn: () => Promise<T>, staleTime = 15_000): Promise<T> {
  return queryClient.fetchQuery({ queryKey: key, queryFn: fn, staleTime, retry: false });
}

/** Always asks the server (pull-to-refresh / Retry), still sharing one request between callers. */
export function refetchFresh<T>(key: readonly unknown[], fn: () => Promise<T>): Promise<T> {
  return queryClient.fetchQuery({ queryKey: key, queryFn: fn, staleTime: 0, retry: false });
}

/** A journey just started / completed: whatever was cached about dispatches is out of date. */
export function invalidateJourneyData(): void {
  for (const root of ['active-dispatch', 'active-raw', 'dispatch-detail', 'ping-history']) {
    void queryClient.cancelQueries({ queryKey: [root] });
    queryClient.removeQueries({ queryKey: [root] });
  }
  for (const root of ['dashboard', 'trip', 'trip-history']) {
    // Mark stale only (no immediate refetch): the next poll / screen open fetches fresh data.
    queryClient.invalidateQueries({ queryKey: [root], refetchType: 'none' });
  }
}

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { queryClient } from '../query/queryClient';

const SESSION_KEY = 'fuji_auth_session';

export interface StoredAuthSession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  user: {
    id: string;
    firstName: string;
    familyName?: string;
    fullName: string;
    alternateName?: string;
    email?: string;
    jobTitle?: string;
    role: 'SITE_ENGINEER' | 'TRUCK_DRIVER';
    avatarUrl?: string;
    externalReferenceCode?: string;
    dateCreated?: string;
    lastLoginDate?: string;
    status?: string;
    vehicleNumber?: string;
    vehicleModel?: string;
  };
}

/**
 * Key/value store for the auth session.
 *
 * - Android / iOS: expo-secure-store (Keystore / Keychain).
 * - Web: expo-secure-store has no web implementation (getValueWithKeyAsync /
 *   setValueWithKeyAsync / deleteValueWithKeyAsync "is not a function"), so
 *   the web build (dev preview only) falls back to localStorage. Every access
 *   is wrapped in try/catch because localStorage can be missing or throw
 *   (private mode, blocked storage).
 */
const isWeb = Platform.OS === 'web';

function webStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

/**
 * SecureStore recommends values of at most ~2 KB. The signed-in session (a JWT access token with
 * a long scope claim, a refresh token and the user) is larger than that, so on native a big value is
 * transparently split into small chunks (key.__0, key.__1 ... plus key.__n = chunk count) and
 * joined again on read. Small values are stored under the plain key exactly as before, so
 * sessions saved by older versions are still read.
 */
const CHUNK_CHARS = 1000;
const countKey = (key: string) => `${key}.__n`;
const chunkKey = (key: string, i: number) => `${key}.__${i}`;

async function nativeRemoveChunks(key: string): Promise<void> {
  const n = Number(await SecureStore.getItemAsync(countKey(key)));
  if (Number.isFinite(n) && n > 0) {
    for (let i = 0; i < n; i += 1) {
      await SecureStore.deleteItemAsync(chunkKey(key, i));
    }
  }
  await SecureStore.deleteItemAsync(countKey(key));
}

async function nativeGet(key: string): Promise<string | null> {
  const n = Number(await SecureStore.getItemAsync(countKey(key)));
  if (Number.isFinite(n) && n > 0) {
    let joined = '';
    for (let i = 0; i < n; i += 1) {
      const part = await SecureStore.getItemAsync(chunkKey(key, i));
      if (part == null) {
        console.warn(`[session] ${key}: chunk ${i}/${n} is missing - treating as not saved`);
        return null;
      }
      joined += part;
    }
    return joined;
  }
  return SecureStore.getItemAsync(key);
}

async function nativeSet(key: string, value: string): Promise<void> {
  await nativeRemoveChunks(key);
  if (value.length <= CHUNK_CHARS) {
    await SecureStore.setItemAsync(key, value);
    return;
  }
  const parts = Math.ceil(value.length / CHUNK_CHARS);
  for (let i = 0; i < parts; i += 1) {
    await SecureStore.setItemAsync(chunkKey(key, i), value.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS));
  }
  await SecureStore.setItemAsync(countKey(key), String(parts)); // written last = the write is complete
  await SecureStore.deleteItemAsync(key);
}

/** Key/value store (SecureStore on native, localStorage on web). Large values are chunked on native. */
export const appStorage = {
  async getItem(key: string): Promise<string | null> {
    if (isWeb) {
      try {
        return webStorage()?.getItem(key) ?? null;
      } catch {
        return null;
      }
    }
    return nativeGet(key);
  },
  async setItem(key: string, value: string): Promise<void> {
    if (isWeb) {
      try {
        webStorage()?.setItem(key, value);
      } catch (err) {
        console.warn('[sessionStorage] web localStorage write failed:', err);
      }
      return;
    }
    await nativeSet(key, value);
  },
  async removeItem(key: string): Promise<void> {
    if (isWeb) {
      try {
        webStorage()?.removeItem(key);
      } catch {
        // ignore
      }
      return;
    }
    await nativeRemoveChunks(key);
    await SecureStore.deleteItemAsync(key);
  },
};

export async function saveAuthSession(
  session: StoredAuthSession,
): Promise<void> {
  const json = JSON.stringify(session);
  await appStorage.setItem(SESSION_KEY, json);
  console.log(
    `[session] saved (${json.length} chars, refresh token ${session.refreshToken ? 'yes' : 'NO'}, expires ${session.expiresAt})`,
  );
}

export async function getAuthSession(): Promise<StoredAuthSession | null> {
  let stored: string | null = null;
  try {
    stored = await appStorage.getItem(SESSION_KEY);
  } catch (err) {
    console.warn('[session] could not read the saved session (SecureStore error):', err);
    return null;
  }
  if (!stored) {
    return null;
  }
  try {
    return JSON.parse(stored) as StoredAuthSession;
  } catch (err) {
    console.warn('[session] saved session is corrupted:', err);
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  await appStorage.removeItem(SESSION_KEY);
  // Logout: nothing cached for this driver may survive into the next login.
  queryClient.clear();
}

export function isSessionExpired(session: StoredAuthSession | null | undefined): boolean {
  if (!session || !session.accessToken) return true;
  if (!session.expiresAt) return false;
  const expiresAtMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return false;
  return expiresAtMs <= Date.now();
}

export function isSessionNearingExpiry(
  session: StoredAuthSession | null | undefined,
  thresholdMs = 60_000,
): boolean {
  if (!session || !session.accessToken) return true;
  if (!session.expiresAt) return false;
  const expiresAtMs = Date.parse(session.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return false;
  return expiresAtMs <= Date.now() + thresholdMs;
}



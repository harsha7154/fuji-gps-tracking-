/**
 * Pending proof of delivery (persisted per driver).
 *
 * Journey flow:
 *   1. Within 100 m the driver taps "Confirm" in the arrival popup -> a pending record is saved
 *      (dispatch ids + the GPS position at confirmation) and the app opens the POD screen.
 *      The dispatch stays In Transit on the server; GPS pings keep running.
 *   2. POD photo uploaded (POST /pod/photo)          -> record.podUploaded = true
 *   3. complete-journey (POST /complete-journey)      -> record cleared, success screen.
 *
 * The record survives app restarts and logout / login of the same driver, so the app returns to
 * the POD screen until the journey is completed. While it exists the arrival popup is not shown.
 */
import { appStorage } from './sessionStorage';

export interface PendingPod {
  userId: string;
  /** Business dispatch code (e.g. "DSP-…"). */
  dispatchId: string;
  /** Liferay object entry id (MaterialDispatchId) used by /pod/photo and /complete-journey. */
  objectEntryId: string;
  /** Position within 100 m of the site at confirmation, sent as liveGPS to complete-journey. */
  latitude: number;
  longitude: number;
  confirmedAt: number;
  /** POD photo is on the server; only complete-journey is left. */
  podUploaded?: boolean;
}

const keyFor = (userId: string) => `fuji_pending_pod_${userId}`;

const cache = new Map<string, PendingPod | null>();
const listeners = new Set<(userId: string, pending: PendingPod | null) => void>();

function notify(userId: string, pending: PendingPod | null) {
  listeners.forEach((listener) => {
    try {
      listener(userId, pending);
    } catch (err) {
      console.warn('[pendingPod] listener failed:', err);
    }
  });
}

/** Pending record of this driver, or null. Never throws. */
export async function getPendingPod(userId?: string | number | null): Promise<PendingPod | null> {
  if (userId === undefined || userId === null || userId === '') return null;
  const uid = String(userId);
  if (cache.has(uid)) return cache.get(uid) ?? null;
  try {
    const raw = await appStorage.getItem(keyFor(uid));
    const parsed = raw ? (JSON.parse(raw) as PendingPod) : null;
    const valid = parsed && parsed.dispatchId && parsed.objectEntryId ? parsed : null;
    cache.set(uid, valid);
    return valid;
  } catch (err) {
    console.warn('[pendingPod] could not read pending POD:', err);
    return null;
  }
}

/** Last loaded record (no storage access); undefined = not loaded yet. */
export function peekPendingPod(userId?: string | number | null): PendingPod | null | undefined {
  if (userId === undefined || userId === null || userId === '') return null;
  return cache.get(String(userId));
}

export async function savePendingPod(pending: PendingPod): Promise<void> {
  const uid = String(pending.userId);
  const value: PendingPod = { ...pending, userId: uid };
  cache.set(uid, value);
  notify(uid, value);
  await appStorage.setItem(keyFor(uid), JSON.stringify(value));
}

export async function markPendingPodUploaded(userId: string | number): Promise<void> {
  const current = await getPendingPod(userId);
  if (!current || current.podUploaded) return;
  await savePendingPod({ ...current, podUploaded: true });
}

export async function clearPendingPod(userId: string | number): Promise<void> {
  const uid = String(userId);
  cache.set(uid, null);
  notify(uid, null);
  await appStorage.removeItem(keyFor(uid));
}

/** Called on every save / clear. Returns the unsubscribe function. */
export function subscribePendingPod(listener: (userId: string, pending: PendingPod | null) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

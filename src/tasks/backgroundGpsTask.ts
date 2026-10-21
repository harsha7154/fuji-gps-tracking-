/**
 * Background GPS pings (app minimised OR closed) while a journey is active.
 *
 * HOW IT WORKS
 *   Android keeps location running outside the app only through a *foreground
 *   service* (the ongoing "Trip in progress" notification). expo-location's
 *   startLocationUpdatesAsync() starts that service and calls the task below
 *   with new fixes, even after the app is swiped away from recents.
 *
 *   Each fix goes through the SAME pipeline the Live GPS screen uses:
 *     fix -> ping gate (utils/pingGate.ts: moved >= 5 m or 60 s heartbeat)
 *         -> GpsWebSocket  ws://<gps-host>:8070/ws/gps/mobile/{dispatchId}
 *
 *   Who sends the pings?
 *     - App open AND Live GPS screen showing -> the screen (unchanged).
 *     - Anything else (home button, screen off, app closed, other screens)
 *       -> this task. The two never send at the same time (see
 *       isForegroundOwning()), so the server does not get duplicates.
 *
 *   The journey details the task needs (dispatch id, vehicle, destination,
 *   device id) are saved in secure storage when tracking starts, because after
 *   the app is closed Android starts a fresh JS runtime that has no memory.
 *
 *   Tracking stops when: the server refuses pings because the journey is
 *   completed/arrived, the driver logs out, the controller sees no In Transit
 *   dispatch any more, or MAX_TRACKING_MS passes (safety net).
 *
 * EXTRAS while the foreground service keeps the app alive:
 *   - checks for new notifications about once a minute and raises a system
 *     (status-bar) notification, instead of waiting for the 15-minute job
 *   - raises a "near destination" notification so the driver can open the app
 *     and confirm arrival
 */

import { AppState, Platform } from 'react-native';
import * as Location from 'expo-location';

import { GpsWebSocket } from '../services/gpsWebSocketService';
import { appStorage } from '../services/sessionStorage';
import { presentLocalAlert } from '../services/systemNotifications';
import { gpsLog, gpsWarn } from '../utils/gpsLogger';
import { decidePing, distanceMeters, LastSentPing } from '../utils/pingGate';
import { loadTaskManagerModule } from '../utils/optionalNativeModules';
import { ensureBackgroundLocationPermission, promptBatteryOptimizationOnce } from '../utils/backgroundPermissions';
import { runBackgroundNotificationCheck } from './backgroundNotificationTask';

export const GPS_BACKGROUND_TASK = 'fuji-background-gps';

const CONFIG_KEY = 'fuji_bg_gps_config';

/** Seconds between location fixes requested from Android (the ping gate still decides what is sent). */
const LOCATION_INTERVAL_MS = 10_000;
/** Ignore fixes older than this (cached positions). */
const MAX_FIX_AGE_MS = 2 * 60_000;
/** Safety net: never track longer than this without a fresh start. */
const MAX_TRACKING_MS = 24 * 60 * 60_000;
/** While tracking in the background, look for new notifications this often. */
const NOTIFICATION_CHECK_EVERY_MS = 60_000;
/** Raise the "near destination" alert inside this distance. */
const NEAR_DESTINATION_M = 150;

export interface BackgroundGpsConfig {
  dispatchId: string;
  vehicleNumber: string;
  deviceId: string;
  destLat: number;
  destLng: number;
  startedAt: number;
}

export type BackgroundGpsStart = Omit<BackgroundGpsConfig, 'startedAt'>;

const TaskManager = loadTaskManagerModule();

// ── in-memory state (lost when the OS recreates the JS runtime — that is fine,
//    everything important is re-read from storage) ───────────────────────────
let foregroundPinging = false;
let backgroundRunning = false;
let socket: GpsWebSocket | null = null;
let socketDispatchId: string | null = null;
let lastSent: LastSentPing | null = null;
let lastNotificationCheckAt = 0;
let nearDestinationAlerted = false;
let startLock: Promise<boolean> | null = null;

// ── foreground / background hand-over ─────────────────────────────────────────

/**
 * The Live GPS screen calls this with true while it is tracking. While true AND
 * the app is in the foreground, the screen sends the pings and this task stays
 * quiet. In a fresh background runtime (app closed) it is always false.
 */
export function setForegroundPinging(active: boolean): void {
  foregroundPinging = active;
  if (active) closeSocket(); // screen has its own socket now
}

function isForegroundOwning(): boolean {
  return foregroundPinging && AppState.currentState === 'active';
}

/** True while the background service is running (screen then skips pings while the app is hidden). */
export function isBackgroundGpsActive(): boolean {
  return backgroundRunning;
}

// ── storage ───────────────────────────────────────────────────────────────────

async function loadConfig(): Promise<BackgroundGpsConfig | null> {
  try {
    const raw = await appStorage.getItem(CONFIG_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as BackgroundGpsConfig;
    return parsed && parsed.dispatchId ? parsed : null;
  } catch {
    return null;
  }
}

async function saveConfig(config: BackgroundGpsConfig): Promise<void> {
  await appStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

async function clearConfig(): Promise<void> {
  try {
    await appStorage.removeItem(CONFIG_KEY);
  } catch {
    // ignore
  }
}

// ── socket ────────────────────────────────────────────────────────────────────

function closeSocket(): void {
  if (socket) {
    try {
      socket.close();
    } catch {
      // ignore
    }
  }
  socket = null;
  socketDispatchId = null;
}

function ensureSocket(config: BackgroundGpsConfig): GpsWebSocket {
  if (socket && socketDispatchId === config.dispatchId) return socket;
  closeSocket();
  socketDispatchId = config.dispatchId;
  lastSent = null;
  socket = new GpsWebSocket(
    { dispatchId: config.dispatchId, deviceId: config.deviceId, vehicleId: config.vehicleNumber },
    {
      onJourneyClosed: (e) => {
        gpsLog('[BG-GPS] journey closed by server -> stopping background tracking', { code: e.code });
        stopBackgroundGpsTracking('journey-closed').catch(() => { });
      },
    },
  );
  socket.connect();
  return socket;
}

// ── the task ──────────────────────────────────────────────────────────────────

async function handleLocations(locations: Location.LocationObject[]): Promise<void> {
  const config = await loadConfig();
  if (!config) {
    // The service is running but nothing is being tracked (stale) -> shut it down.
    await stopBackgroundGpsTracking('no-config');
    return;
  }
  if (Date.now() - config.startedAt > MAX_TRACKING_MS) {
    await stopBackgroundGpsTracking('max-duration');
    return;
  }

  // App is open on the Live GPS screen: it sends the pings.
  if (isForegroundOwning()) return;

  const ws = ensureSocket(config);

  for (const loc of locations) {
    const ageMs = Date.now() - loc.timestamp;
    if (ageMs > MAX_FIX_AGE_MS) {
      gpsWarn('[BG-GPS] fix discarded (stale)', { ageMs });
      continue;
    }

    const { latitude, longitude, accuracy, speed, heading } = loc.coords;
    const fix = { latitude, longitude };
    const decision = decidePing(fix, lastSent, Date.now());

    if (decision.send) {
      const result = ws.send({
        latitude,
        longitude,
        accuracy: accuracy ?? 0,
        speed: speed ?? 0,
        heading: heading ?? 0,
        timestamp: decision.reason === 'heartbeat' ? Date.now() : loc.timestamp,
      });
      if (result !== 'dropped') {
        lastSent = { latitude, longitude, sentAt: Date.now() };
        gpsLog(`[BG-GPS] PING ${result.toUpperCase()}`, {
          reason: decision.reason,
          lat: latitude,
          lng: longitude,
          movedM: Number(decision.movedMeters.toFixed(1)),
          app: AppState.currentState,
          socket: ws.getStatus(),
          queued: ws.getQueuedCount(),
        });
      }
    }

    // "Near the destination" alert (once per journey) so the driver can open the app and confirm.
    if (!nearDestinationAlerted && config.destLat && config.destLng) {
      const meters = distanceMeters(fix, { latitude: config.destLat, longitude: config.destLng });
      if (meters <= NEAR_DESTINATION_M) {
        nearDestinationAlerted = true;
        await presentLocalAlert(
          `near-destination-${config.dispatchId}`,
          'You are near the destination',
          'Open the app and confirm "Arrived" to complete the journey.',
        );
      }
    }
  }

  // Fast notification check while the service keeps the app alive.
  if (Date.now() - lastNotificationCheckAt >= NOTIFICATION_CHECK_EVERY_MS) {
    lastNotificationCheckAt = Date.now();
    try {
      await runBackgroundNotificationCheck();
    } catch (err) {
      gpsWarn('[BG-GPS] notification check failed', { err: String(err) });
    }
  }
}

if (TaskManager && Platform.OS !== 'web') {
  try {
    TaskManager.defineTask(
      GPS_BACKGROUND_TASK,
      async ({ data, error }: { data?: { locations?: Location.LocationObject[] }; error?: { message?: string } | null }) => {
        if (error) {
          gpsWarn('[BG-GPS] task error', { message: error.message });
          return;
        }
        const locations = data?.locations;
        if (!locations || locations.length === 0) return;
        try {
          await handleLocations(locations);
        } catch (err) {
          gpsWarn('[BG-GPS] task failed', { err: String(err) });
        }
      },
    );
  } catch (err) {
    console.warn('[backgroundGpsTask] could not define the task:', err);
  }
}

// ── public API ────────────────────────────────────────────────────────────────

/**
 * Starts (or keeps running) background tracking for this dispatch. Must be
 * called while the app is visible (Android only allows starting a location
 * foreground service from the foreground). Safe to call repeatedly. Never throws.
 * Returns true when the background service is running afterwards.
 */
export function startBackgroundGpsTracking(start: BackgroundGpsStart): Promise<boolean> {
  if (startLock) return startLock;
  const run = doStart(start).finally(() => {
    startLock = null;
  });
  startLock = run;
  return run;
}

async function doStart(start: BackgroundGpsStart): Promise<boolean> {
  if (Platform.OS === 'web' || !TaskManager) return false;
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') {
      gpsWarn('[BG-GPS] not started: location permission not granted');
      return false;
    }

    // Best-effort, once per install: "Allow all the time" + battery exemption (never blocks tracking).
    if (AppState.currentState === 'active') {
      await ensureBackgroundLocationPermission();
      await promptBatteryOptimizationOnce();
    }

    const existing = await loadConfig();
    const sameDispatch = existing?.dispatchId === start.dispatchId;
    const running = await Location.hasStartedLocationUpdatesAsync(GPS_BACKGROUND_TASK).catch(() => false);

    if (running && sameDispatch) {
      backgroundRunning = true;
      return true;
    }
    if (running) await Location.stopLocationUpdatesAsync(GPS_BACKGROUND_TASK).catch(() => { });

    nearDestinationAlerted = false;
    await saveConfig({ ...start, startedAt: Date.now() });

    await Location.startLocationUpdatesAsync(GPS_BACKGROUND_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: LOCATION_INTERVAL_MS,
      distanceInterval: 0, // time based, so the 60 s "parked" heartbeat still works
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Fuji Silvertech - trip in progress',
        notificationBody: `Sharing live location for dispatch ${start.dispatchId}`,
        notificationColor: '#023c69',
        killServiceOnDestroy: false, // keep running when the app is swiped away
      },
    });

    backgroundRunning = true;
    gpsLog('[BG-GPS] background tracking STARTED', { dispatch: start.dispatchId });
    return true;
  } catch (err) {
    backgroundRunning = false;
    gpsWarn('[BG-GPS] could not start background tracking', { err: String(err) });
    await clearConfig();
    return false;
  }
}

/** Stops background tracking and forgets the journey. Safe to call anytime. Never throws. */
export async function stopBackgroundGpsTracking(reason = 'stopped'): Promise<void> {
  backgroundRunning = false;
  closeSocket();
  lastSent = null;
  nearDestinationAlerted = false;
  await clearConfig();
  if (Platform.OS === 'web' || !TaskManager) return;
  try {
    if (await Location.hasStartedLocationUpdatesAsync(GPS_BACKGROUND_TASK)) {
      await Location.stopLocationUpdatesAsync(GPS_BACKGROUND_TASK);
      gpsLog('[BG-GPS] background tracking STOPPED', { reason });
    }
  } catch (err) {
    gpsWarn('[BG-GPS] stop failed', { err: String(err) });
  }
}

/** Syncs the in-memory flag after the app (re)opens while the service is already running. */
export async function refreshBackgroundGpsState(): Promise<boolean> {
  if (Platform.OS === 'web' || !TaskManager) return false;
  try {
    backgroundRunning = await Location.hasStartedLocationUpdatesAsync(GPS_BACKGROUND_TASK);
  } catch {
    backgroundRunning = false;
  }
  return backgroundRunning;
}

/**
 * Watchdog: if a journey is saved but the OS stopped the location service (OEM battery killer,
 * crash...), start it again. Called by the 15-minute background job. Starting a location service
 * from the background only works when "Allow all the time" was granted; otherwise it fails
 * quietly and tracking resumes the next time the driver opens the app.
 */
export async function resumeBackgroundGpsIfNeeded(): Promise<void> {
  if (Platform.OS === 'web' || !TaskManager) return;
  try {
    const config = await loadConfig();
    if (!config) return;
    if (Date.now() - config.startedAt > MAX_TRACKING_MS) {
      await stopBackgroundGpsTracking('max-duration');
      return;
    }
    if (await Location.hasStartedLocationUpdatesAsync(GPS_BACKGROUND_TASK).catch(() => false)) return;
    gpsWarn('[BG-GPS] service was not running - restarting', { dispatch: config.dispatchId });
    const { startedAt: _ignored, ...start } = config;
    await Location.startLocationUpdatesAsync(GPS_BACKGROUND_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: LOCATION_INTERVAL_MS,
      distanceInterval: 0,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: 'Fuji Silvertech - trip in progress',
        notificationBody: `Sharing live location for dispatch ${start.dispatchId}`,
        notificationColor: '#023c69',
        killServiceOnDestroy: false,
      },
    });
    backgroundRunning = true;
  } catch (err) {
    gpsWarn('[BG-GPS] resume failed', { err: String(err) });
  }
}

import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { driverGpsService } from '../services/driverGpsService';
import { isBackgroundGpsActive, refreshBackgroundGpsState, startBackgroundGpsTracking, stopBackgroundGpsTracking } from '../tasks/backgroundGpsTask';
import { ensureForegroundLocationPermission } from '../utils/currentLocation';
import { getDeviceId } from '../utils/deviceId';
import { DISPATCH_STATUS } from '../utils/dispatchStatus';
import { gpsLog, gpsWarn } from '../utils/gpsLogger';

/** How often the In Transit dispatch is re-checked while the app is open. */
const CHECK_EVERY_MS = 20_000;
/** A copy of the active dispatch this young (fetched by another component) is reused instead of asking the server again. */
const SHARED_MAX_AGE_MS = 14_000;
/** "No active dispatch" must be seen this many checks in a row before tracking stops (guards against a network blip). */
const MISSES_BEFORE_STOP = 6;

interface BackgroundGpsControllerProps {
  /** Signed in as a truck driver. */
  enabled: boolean;
  userId?: string | null;
  accessToken?: string | null;
}

/**
 * Renders nothing. While the signed-in driver has an In Transit dispatch it keeps
 * the background GPS service (tasks/backgroundGpsTask.ts) running — on EVERY
 * screen, not only the Live GPS screen — so pings continue when the app is
 * minimised or closed. When the dispatch is no longer In Transit it stops it.
 *
 * Logging out stops tracking separately (AppNavigator.handleLogout).
 */
export const BackgroundGpsController: React.FC<BackgroundGpsControllerProps> = ({ enabled, userId, accessToken }) => {
  const tokenRef = useRef<string | null | undefined>(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    if (!enabled || !userId) return;

    let cancelled = false;
    let running = false;
    let misses = 0;

    // The service may already be running from before the app was reopened.
    refreshBackgroundGpsState().catch(() => { });

    const check = async () => {
      if (running || cancelled) return;
      running = true;
      try {
        const token = tokenRef.current ?? undefined;
        // Shared with GlobalArrivalPrompt and the Live GPS screen: reuses their result when it is fresh.
        const active = await driverGpsService.getActiveWithDetail(userId, token, SHARED_MAX_AGE_MS);
        if (cancelled) return;

        if (active && active.dispatchID && active.statusDispatch === DISPATCH_STATUS.IN_TRANSIT) {
          misses = 0;
          // Android 12+ only allows STARTING a location foreground service while the app is visible;
          // when hidden it is either already running (kept alive) or will be started on return.
          if (AppState.currentState !== 'active') return;
          const granted = await ensureForegroundLocationPermission();
          if (!granted || cancelled) return;
          const deviceId = await getDeviceId();
          const started = await startBackgroundGpsTracking({
            dispatchId: active.dispatchID,
            vehicleNumber: active.vehicleNumber || '',
            deviceId,
            destLat: Number(active.destinationLatitude) || 0,
            destLng: Number(active.destinationLongitude) || 0,
          });
          if (!started) gpsWarn('[BG-GPS controller] background tracking could not start', { dispatch: active.dispatchID });
          return;
        }

        if (active) {
          // A dispatch exists but it is not In Transit (planned / arrived): nothing to track.
          misses = 0;
          if (isBackgroundGpsActive()) await stopBackgroundGpsTracking('dispatch-not-in-transit');
          return;
        }

        // Nothing came back — could be a real "no active dispatch" or a failed request.
        misses += 1;
        if (misses >= MISSES_BEFORE_STOP && isBackgroundGpsActive()) {
          gpsLog('[BG-GPS controller] no In Transit dispatch for a while', { misses });
          await stopBackgroundGpsTracking('no-active-dispatch');
        }
      } catch (err) {
        gpsWarn('[BG-GPS controller] check failed', { err: String(err) });
      } finally {
        running = false;
      }
    };

    check();
    const timer = setInterval(check, CHECK_EVERY_MS);
    // Coming back to the app: re-check straight away.
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });

    return () => {
      cancelled = true;
      clearInterval(timer);
      appStateSub.remove();
    };
  }, [enabled, userId]);

  return null;
};

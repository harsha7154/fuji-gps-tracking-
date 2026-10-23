import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { driverGpsService, formatLiveGps, JourneyError } from '../services/driverGpsService';
import { getCurrentCoords, LocationUnavailableError } from '../utils/currentLocation';
import { getDeviceId } from '../utils/deviceId';
import { openMapsNavigation } from '../utils/openMapsNavigation';
import { DISPATCH_STATUS } from '../utils/dispatchStatus';
import { colors, radius, spacing, typography } from '../theme';

interface DispatchGpsToggleProps {
  dispatchId: string;
  /** dispatch.MaterialDispatchId — the {objectEntryId} param of start-journey. */
  objectEntryId?: number;
  /** 3 = Dispatched, 1 = In Transit, 0 = Arrived (see utils/dispatchStatus.ts). */
  statusDispatch?: number;
  accessToken?: string;
  /** Fired only after start-journey succeeded, so the parent can flip this dispatch to In Transit. */
  onJourneyStarted?: (dispatchId: string) => void;
  onOpenLiveGps?: (dispatchId: string, objectEntryId?: number) => void;
  /** Site (destination) position — used by the "Open Maps" button. */
  destLatitude?: number;
  destLongitude?: number;
  destLabel?: string;
}

/**
 * The single call-to-action shown on every dispatch card. Purely driven by
 * `statusDispatch`:
 *
 *   3 (Dispatched)  ->  "Activate Journey"   POST /o/material-dispatch-rest/start-journey
 *                       ?objectEntryId={MaterialDispatchId}&deviceID={this phone}&liveGPS={lat,lng}
 *                       on success the parent sets statusDispatch = 1, so this
 *                       same spot immediately becomes the Live GPS button.
 *   1 (In Transit)  ->  "Live GPS" button    opens the live tracking screen
 *   0 (Arrived)     ->  "Journey Completed" badge (no action)
 *   anything else   ->  renders nothing (unknown status: never offer an action we can't vouch for)
 */
export const DispatchGpsToggle: React.FC<DispatchGpsToggleProps> = ({
  dispatchId,
  objectEntryId,
  statusDispatch,
  accessToken,
  onJourneyStarted,
  onOpenLiveGps,
  destLatitude,
  destLongitude,
  destLabel,
}) => {
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingLabel, setLoadingLabel] = useState<string>('Activating Journey...');
  const [error, setError] = useState<string | null>(null);

  // Synchronous double-tap guard: `loading` state alone is async, so two fast
  // taps could both get through before the re-render disables the button.
  const inFlightRef = useRef<boolean>(false);
  const isMountedRef = useRef<boolean>(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const handleActivate = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setLoading(true);
    setError(null);

    try {
      if (objectEntryId === undefined) {
        throw new JourneyError('This dispatch is missing its ID. Please refresh and try again.');
      }

      if (isMountedRef.current) setLoadingLabel('Getting your location...');
      const [coords, deviceId] = await Promise.all([getCurrentCoords(), getDeviceId()]);

      if (isMountedRef.current) setLoadingLabel('Activating Journey...');
      await driverGpsService.startJourney(
        {
          objectEntryId,
          deviceId,
          liveGPS: formatLiveGps(coords.latitude, coords.longitude),
        },
        accessToken
      );
      // Notify the parent even if this card unmounted mid-request: the journey
      // WAS started on the server and the parent needs to know.
      onJourneyStarted?.(dispatchId);
    } catch (err) {
      console.warn('[DispatchGpsToggle] start-journey failed:', err);
      if (isMountedRef.current) {
        setError(
          err instanceof JourneyError || err instanceof LocationUnavailableError
            ? err.message
            : 'Could not start the journey. Please try again.'
        );
      }
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current) setLoading(false);
    }
  }, [dispatchId, objectEntryId, accessToken, onJourneyStarted]);

  const handleOpenLiveGps = useCallback(() => {
    onOpenLiveGps?.(dispatchId, objectEntryId);
  }, [dispatchId, objectEntryId, onOpenLiveGps]);

  // Hands the site position to the phone's Maps app (turn-by-turn). No Google API call, no cost.
  const handleOpenMaps = useCallback(() => {
    openMapsNavigation(Number(destLatitude), Number(destLongitude), destLabel);
  }, [destLatitude, destLongitude, destLabel]);

  // 0 · ARRIVED
  if (statusDispatch === DISPATCH_STATUS.ARRIVED) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.btnArrivedDisabled}>
          <Ionicons name="checkmark-circle" size={16} color="#15803d" style={styles.icon} />
          <Text style={styles.btnArrivedDisabledText}>Journey Completed • Arrived at Site</Text>
        </View>
        {onOpenLiveGps ? (
          <Pressable
            onPress={handleOpenLiveGps}
            accessibilityRole="button"
            accessibilityLabel="View the travelled route on the map"
            style={({ pressed }) => [styles.btnViewRoute, pressed && styles.pressed]}
          >
            <Ionicons name="map-outline" size={15} color={colors.primary} style={styles.icon} />
            <Text style={styles.btnViewRouteText}>View Travelled Route</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  // 1 · IN TRANSIT
  if (statusDispatch === DISPATCH_STATUS.IN_TRANSIT) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.actionRow}>
          <Pressable
            onPress={handleOpenLiveGps}
            accessibilityRole="button"
            accessibilityLabel="Open live GPS tracking"
            style={({ pressed }) => [styles.btnActivate, pressed && styles.pressed]}
          >
            <Ionicons name="location" size={17} color={colors.white} style={styles.icon} />
            <Text style={styles.btnTextWhite}>Live GPS →</Text>
          </Pressable>
          <Pressable
            onPress={handleOpenMaps}
            accessibilityRole="button"
            accessibilityLabel="Open Maps navigation to the site"
            style={({ pressed }) => [styles.btnViewMap, pressed && styles.pressed]}
          >
            <Ionicons name="map-outline" size={17} color="#0B5FA8" style={styles.icon} />
            <Text style={styles.btnViewMapText}>View Map</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // 3 · DISPATCHED
  if (statusDispatch === DISPATCH_STATUS.DISPATCHED) {
    return (
      <View style={styles.wrapper}>
        <View style={styles.actionRow}>
          <Pressable
            onPress={handleActivate}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel="Activate journey"
            accessibilityState={{ disabled: loading, busy: loading }}
            style={({ pressed }) => [
              styles.btnActivate,
              loading && styles.btnActivating,
              pressed && !loading && styles.pressed,
            ]}
          >
            {loading ? (
              <>
                <ActivityIndicator size="small" color={colors.white} style={styles.icon} />
                <Text style={styles.btnTextWhite}>{loadingLabel}</Text>
              </>
            ) : (
              <>
                <Ionicons name="play-circle" size={18} color={colors.white} style={styles.icon} />
                <Text style={styles.btnTextWhite}>Activate Journey</Text>
              </>
            )}
          </Pressable>
          {onOpenLiveGps ? (
            <Pressable
              onPress={handleOpenLiveGps}
              accessibilityRole="button"
              accessibilityLabel="View the map"
              style={({ pressed }) => [styles.btnViewMap, pressed && styles.pressed]}
            >
              <Ionicons name="map-outline" size={18} color="#0B5FA8" style={styles.icon} />
              <Text style={styles.btnViewMapText}>View Map</Text>
            </Pressable>
          ) : null}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </View>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  wrapper: {
    marginTop: spacing.xs,
    alignItems: 'stretch',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  icon: {
    marginRight: 6,
  },
  pressed: {
    opacity: 0.85,
  },
  btnActivate: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#0B5FA8',
    paddingVertical: 12,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
  },
  btnActivating: {
    backgroundColor: '#08477e',
  },
  btnViewMap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: '#0B5FA8',
    backgroundColor: colors.white,
  },
  btnViewMapText: {
    ...typography.label,
    fontSize: 13.5,
    fontWeight: '700',
    color: '#0B5FA8',
  },
  btnViewRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 6,
    paddingVertical: 9,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: colors.white,
  },
  btnViewRouteText: {
    ...typography.label,
    fontSize: 12,
    fontWeight: '700',
    color: colors.primary,
  },
  btnArrivedDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#dcfce7',
    borderWidth: 1,
    borderColor: '#bbf7d0',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  btnArrivedDisabledText: {
    ...typography.label,
    fontSize: 12,
    fontWeight: '700',
    color: '#15803d',
  },
  btnTextWhite: {
    ...typography.label,
    fontSize: 13.5,
    fontWeight: '700',
    color: colors.white,
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
    marginTop: 6,
    textAlign: 'center',
  },
});

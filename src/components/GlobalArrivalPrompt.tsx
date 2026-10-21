import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { driverGpsService, formatLiveGps, JourneyError } from '../services/driverGpsService';
import type { DispatchItem } from '../types/driverDashboard';
import { ensureForegroundLocationPermission } from '../utils/currentLocation';
import { getDeviceId } from '../utils/deviceId';
import { DISPATCH_STATUS } from '../utils/dispatchStatus';
import { arrivalConfirmationService } from '../services/arrivalConfirmationService';
import { gpsLog, gpsWarn } from '../utils/gpsLogger';
import { colors, radius, spacing, typography } from '../theme';

// Same numbers as DriverGpsTrackingScreen so behaviour is identical on every screen.
const ARRIVAL_RADIUS_M = 100;
const ARRIVAL_EXIT_RADIUS_M = 125;
const ARRIVAL_REPROMPT_MS = 10_000;
// How often we re-check which dispatch is In Transit.
const DISPATCH_REFRESH_MS = 15_000;
const MAX_FIX_AGE_MS = 8000;

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

interface GlobalArrivalPromptProps {
  /** false while signed out, or on the Live GPS screen (it shows its own popup). */
  enabled: boolean;
  userId?: string | null;
  accessToken?: string | null;
  /** Called after complete-journey succeeded, so the app can open the tracking screen. */
  onJourneyCompleted: (dispatchId: string, objectEntryId?: number | string) => void;
}

/**
 * "Destination arrived?" popup that appears on ANY screen.
 *
 * While the driver has an In Transit dispatch it watches the phone's GPS. Within 100 m of the
 * site it shows the popup; "Not yet" asks again after 10 s while still inside the zone;
 * "Arrived" calls complete-journey.
 */
export const GlobalArrivalPrompt: React.FC<GlobalArrivalPromptProps> = ({
  enabled,
  userId,
  accessToken,
  onJourneyCompleted,
}) => {
  const [dispatch, setDispatch] = useState<DispatchItem | null>(null);
  const [visible, setVisible] = useState(false);
  const [distanceM, setDistanceM] = useState<number | null>(null);
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tokenRef = useRef<string | null | undefined>(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  const lastFixRef = useRef<[number, number] | null>(null);
  const zoneActiveRef = useRef(false);
  const dismissedRef = useRef(false);
  const dismissedAtRef = useRef(0);
  const visibleRef = useRef(false);
  const completingRef = useRef(false);

  const setPromptVisible = useCallback((v: boolean) => {
    visibleRef.current = v;
    setVisible(v);
  }, []);

  // ── 1. Find the In Transit dispatch (re-checked every 15 s) ──────────────
  useEffect(() => {
    if (!enabled || !userId) {
      setDispatch(null);
      setPromptVisible(false);
      return;
    }

    let cancelled = false;

    const load = async () => {
      // A hidden app has no popup to show: skip the request (it re-checks the moment the app is visible again).
      if (AppState.currentState !== 'active') return;
      try {
        const token = tokenRef.current ?? undefined;
        // Shared with BackgroundGpsController and the Live GPS screen: one request, not three.
        const active = await driverGpsService.getActiveWithDetail(userId, token, DISPATCH_REFRESH_MS - 1000);
        if (cancelled) return;

        const effectiveStatus = active
          ? arrivalConfirmationService.getEffectiveStatus(active.dispatchID, active.statusDispatch)
          : undefined;

        const inTransit =
          active &&
          effectiveStatus === DISPATCH_STATUS.IN_TRANSIT &&
          Number(active.destinationLatitude) &&
          Number(active.destinationLongitude);

        setDispatch((prev) => {
          const next = inTransit ? (active as DispatchItem) : null;
          if (prev?.dispatchID === next?.dispatchID) return prev; // keep watcher running
          gpsLog('[GlobalArrival] active dispatch', { dispatch: next?.dispatchID ?? null });
          return next;
        });
      } catch (err) {
        gpsWarn('[GlobalArrival] could not load active dispatch', { err: String(err) });
      }
    };

    load();
    const timer = setInterval(load, DISPATCH_REFRESH_MS);
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      appStateSub.remove();
    };
  }, [enabled, userId, setPromptVisible]);

  const dispatchKey = dispatch?.dispatchID ?? null;
  const destLat = Number(dispatch?.destinationLatitude) || 0;
  const destLng = Number(dispatch?.destinationLongitude) || 0;

  // ── 2. Watch GPS while a dispatch is In Transit ──────────────────────────
  useEffect(() => {
    if (!enabled || !dispatchKey || !destLat || !destLng) return;

    let isMounted = true;
    let sub: Location.LocationSubscription | null = null;
    zoneActiveRef.current = false;
    dismissedRef.current = false;

    const check = (meters: number) => {
      const inZone = meters <= ARRIVAL_RADIUS_M || (zoneActiveRef.current && meters <= ARRIVAL_EXIT_RADIUS_M);

      if (inZone) {
        if (!zoneActiveRef.current) {
          zoneActiveRef.current = true;
          gpsLog('[GlobalArrival] zone entered', { distM: Math.round(meters) });
        }
        if (dismissedRef.current && Date.now() - dismissedAtRef.current >= ARRIVAL_REPROMPT_MS) {
          dismissedRef.current = false;
        }
        if (!dismissedRef.current && !visibleRef.current && !completingRef.current) {
          gpsLog('[GlobalArrival] POPUP shown', { distM: Math.round(meters), dispatch: dispatchKey });
          setPromptVisible(true);
        }
      } else {
        zoneActiveRef.current = false;
        dismissedRef.current = false;
        if (visibleRef.current && !completingRef.current) setPromptVisible(false);
      }
    };

    (async () => {
      const granted = await ensureForegroundLocationPermission();
      if (!isMounted || !granted) {
        if (!granted) gpsWarn('[GlobalArrival] location permission denied');
        return;
      }
      try {
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 2000, distanceInterval: 1 },
          (pos) => {
            if (!isMounted) return;
            if (Date.now() - pos.timestamp > MAX_FIX_AGE_MS) return;
            const { latitude, longitude } = pos.coords;
            lastFixRef.current = [latitude, longitude];
            const meters = haversineM(latitude, longitude, destLat, destLng);
            setDistanceM(meters);
            check(meters);
          }
        );
        if (!isMounted) {
          sub.remove();
          sub = null;
        }
      } catch (err) {
        gpsWarn('[GlobalArrival] location watch failed', { err: String(err) });
      }
    })();

    return () => {
      isMounted = false;
      sub?.remove();
    };
  }, [enabled, dispatchKey, destLat, destLng, setPromptVisible]);

  // ── Buttons ──────────────────────────────────────────────────────────────
  const handleNotYet = useCallback(() => {
    if (completingRef.current) return;
    dismissedRef.current = true;
    dismissedAtRef.current = Date.now();
    setError(null);
    setPromptVisible(false);
  }, [setPromptVisible]);

  const handleArrived = useCallback(async () => {
    if (completingRef.current || !dispatch) return;
    const objectEntryId = dispatch.MaterialDispatchId ?? dispatch.objectEntryId;
    const at = lastFixRef.current;
    if (objectEntryId === undefined) {
      setError('This dispatch is missing its ID. Please open Live GPS and complete it there.');
      return;
    }
    if (!at) {
      setError('Waiting for a GPS fix...');
      return;
    }

    completingRef.current = true;
    setCompleting(true);
    setError(null);
    try {
      const deviceId = await getDeviceId();
      console.log('[GlobalArrivalPrompt] Requesting completeJourney:', {
        dispatchId: dispatch.dispatchID,
        objectEntryId,
      });
      await driverGpsService.completeJourney(
        { objectEntryId, deviceId, liveGPS: formatLiveGps(at[0], at[1]) },
        tokenRef.current ?? undefined
      );
      gpsLog('[GlobalArrival] complete-journey ok', { dispatch: dispatch.dispatchID });
      arrivalConfirmationService.confirmArrival(dispatch.dispatchID);
      if (objectEntryId !== undefined) {
        arrivalConfirmationService.confirmArrival(objectEntryId);
      }
      console.log('[GlobalArrivalPrompt] completeJourney ok. Dispatch arrived:', {
        dispatchId: dispatch.dispatchID,
        objectEntryId,
      });
      setPromptVisible(false);
      setDispatch(null); // stops the GPS watcher
      const completedDispatchId = dispatch.dispatchID || String(objectEntryId);
      console.log('[GlobalArrivalPrompt] Immediately before arrival confirmation callback:', {
        selectedDispatchId: completedDispatchId,
        objectEntryId,
        distanceM,
        arrivalState: {
          radiusM: ARRIVAL_RADIUS_M,
          exitRadiusM: ARRIVAL_EXIT_RADIUS_M,
          zoneActive: zoneActiveRef.current,
          distanceM,
        },
        navigationDecision: 'Journey complete succeeded; invoking onJourneyCompleted callback to route driver to tracking and reveal POD flow',
      });
      onJourneyCompleted(completedDispatchId, objectEntryId);
      console.log('[GlobalArrivalPrompt] Immediately after arrival confirmation callback:', {
        selectedDispatchId: completedDispatchId,
        objectEntryId,
        navigationDecision: 'onJourneyCompleted callback completed',
      });
    } catch (err) {
      setError(err instanceof JourneyError ? err.message : 'Could not complete the journey. Please try again.');
    } finally {
      completingRef.current = false;
      setCompleting(false);
    }
  }, [dispatch, distanceM, onJourneyCompleted, setPromptVisible]);

  const siteName = dispatch?.siteName || dispatch?.destinationSiteAWC || 'Anganwadi Site';

  return (
    <Modal
      visible={visible && enabled}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={handleNotYet}
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.iconCircle}>
            <Ionicons name="location" size={30} color={colors.statGreenIcon} />
          </View>

          <Text style={styles.title}>Destination arrived</Text>
          <Text style={styles.site}>{siteName}</Text>
          <Text style={styles.body}>
            {distanceM !== null ? `You are ${formatDistance(distanceM)} from the site. ` : ''}
            Have you arrived? Tap "Arrived" to complete this journey.
          </Text>

          <View style={styles.tripRow}>
            <Text style={styles.tripText} numberOfLines={1}>
              {dispatch?.dispatchID}
              {dispatch?.vehicleNumber ? ` • ${dispatch.vehicleNumber}` : ''}
            </Text>
          </View>

          {error ? (
            <View style={styles.errorBox}>
              <Ionicons name="warning" size={16} color={colors.error} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.buttons}>
            <Pressable
              onPress={handleNotYet}
              disabled={completing}
              accessibilityRole="button"
              accessibilityLabel="Not yet"
              style={({ pressed }) => [styles.button, styles.cancel, (pressed || completing) && styles.dim]}
            >
              <Text style={styles.cancelText}>Not yet</Text>
            </Pressable>

            <Pressable
              onPress={handleArrived}
              disabled={completing}
              accessibilityRole="button"
              accessibilityLabel="Arrived, complete the journey"
              style={({ pressed }) => [styles.button, styles.confirm, pressed && styles.dim]}
            >
              {completing ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.confirmText}>{error ? 'Try Again' : 'Arrived'}</Text>
              )}
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.statGreenBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: { ...typography.h2, fontSize: 19, color: colors.textPrimary, textAlign: 'center' },
  site: { ...typography.label, fontWeight: '800', color: colors.primary, marginTop: 4, textAlign: 'center' },
  body: { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center', marginTop: spacing.sm },
  tripRow: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.concreteLighter,
  },
  tripText: { ...typography.caption, fontWeight: '700', color: colors.darkGray },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: spacing.sm,
    alignSelf: 'stretch',
  },
  errorText: { ...typography.bodySmall, color: colors.error, flex: 1 },
  buttons: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'stretch', marginTop: spacing.lg },
  button: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancel: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.borderGray },
  confirm: { backgroundColor: colors.statGreenIcon },
  dim: { opacity: 0.7 },
  cancelText: { ...typography.button, color: colors.darkGray },
  confirmText: { ...typography.button, color: colors.white },
});

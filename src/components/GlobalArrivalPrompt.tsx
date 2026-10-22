import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { driverGpsService } from '../services/driverGpsService';
import { getPendingPod, savePendingPod, subscribePendingPod } from '../services/pendingPodService';
import type { DispatchItem } from '../types/driverDashboard';
import { ensureForegroundLocationPermission } from '../utils/currentLocation';
import { DISPATCH_STATUS } from '../utils/dispatchStatus';
import { arrivalConfirmationService } from '../services/arrivalConfirmationService';
import { gpsLog, gpsWarn } from '../utils/gpsLogger';
import { qk, queryClient } from '../query/queryClient';
import { colors, radius, spacing, typography } from '../theme';

// Same numbers as DriverGpsTrackingScreen so behaviour is identical on every screen.
const ARRIVAL_RADIUS_M = 100;
const ARRIVAL_EXIT_RADIUS_M = 125;
const ARRIVAL_REPROMPT_MS = 5_000;
// A shared active-dispatch copy this young is reused when the popup (re)starts.
// No timer of its own: BackgroundGpsController keeps the shared copy current and this
// component follows every update of it (see the cache subscription below).
const SHARED_MAX_AGE_MS = 60_000;
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
  /** Driver tapped "Confirm": the app opens the POD screen (journey completes after the POD upload). */
  onArrivalConfirmed: (dispatchId: string, objectEntryId?: number | string) => void;
}

/**
 * "Destination arrived?" popup that appears on ANY screen.
 *
 * While the driver has an In Transit dispatch it watches the phone's GPS. Within 100 m of the
 * site it shows the popup; "Not yet" asks again every 5 s while still inside the zone;
 * "Confirm" saves the arrival and opens the POD screen (complete-journey runs after the POD upload).
 */
export const GlobalArrivalPrompt: React.FC<GlobalArrivalPromptProps> = ({
  enabled,
  userId,
  accessToken,
  onArrivalConfirmed,
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
  // Arrival already confirmed, POD pending (persisted): no popup until the journey is completed.
  const podPendingRef = useRef(false);
  const repromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setPromptVisible = useCallback((v: boolean) => {
    visibleRef.current = v;
    setVisible(v);
  }, []);

  // ── 1. Find the In Transit dispatch (follows the shared active-dispatch cache) ──
  useEffect(() => {
    if (!enabled || !userId) {
      setDispatch(null);
      setPromptVisible(false);
      return;
    }

    let cancelled = false;

    const apply = (active: DispatchItem | null) => {
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
    };

    const load = async () => {
      // A hidden app has no popup to show: skip the request (it re-checks the moment the app is visible again).
      if (AppState.currentState !== 'active') return;
      try {
        const token = tokenRef.current ?? undefined;
        // Shared with BackgroundGpsController and the Live GPS screen: one request, not three.
        apply(await driverGpsService.getActiveWithDetail(userId, token, SHARED_MAX_AGE_MS));
      } catch (err) {
        gpsWarn('[GlobalArrival] could not load active dispatch', { err: String(err) });
      }
    };

    // Follow the shared active-dispatch copy: whenever anyone refreshes it, re-evaluate (no request here).
    const activeKey = qk.active(userId);
    const unsubCache = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated') return;
      const key = event.query.queryKey;
      if (key[0] !== activeKey[0] || key[1] !== activeKey[1]) return;
      if (event.action.type === 'success') apply((event.query.state.data as DispatchItem) ?? null);
      // "No active dispatch" is reported as an error by getActiveWithDetail (never cached as data).
      else if (event.action.type === 'error') apply(null);
    });

    load();
    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') load();
    });
    return () => {
      cancelled = true;
      unsubCache();
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
        if (!dismissedRef.current && !visibleRef.current && !completingRef.current && !podPendingRef.current) {
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

  // Pending POD of this driver: hide the popup and keep it hidden until the journey is completed.
  useEffect(() => {
    if (!userId) {
      podPendingRef.current = false;
      return;
    }
    const uid = String(userId);
    const apply = (pending: unknown) => {
      podPendingRef.current = Boolean(pending);
      if (pending && visibleRef.current) setPromptVisible(false);
    };
    let active = true;
    getPendingPod(uid).then((p) => {
      if (active) apply(p);
    });
    const unsub = subscribePendingPod((changedUser, p) => {
      if (changedUser === uid) apply(p);
    });
    return () => {
      active = false;
      unsub();
    };
  }, [userId, setPromptVisible]);

  useEffect(() => () => {
    if (repromptTimerRef.current) clearTimeout(repromptTimerRef.current);
  }, []);

  // ── Buttons ──────────────────────────────────────────────────────────────
  const handleNotYet = useCallback(() => {
    if (completingRef.current) return;
    dismissedRef.current = true;
    dismissedAtRef.current = Date.now();
    setError(null);
    setPromptVisible(false);
    // Ask again after ARRIVAL_REPROMPT_MS even without a new GPS fix (truck standing still).
    if (repromptTimerRef.current) clearTimeout(repromptTimerRef.current);
    repromptTimerRef.current = setTimeout(() => {
      repromptTimerRef.current = null;
      if (!dismissedRef.current || !zoneActiveRef.current || podPendingRef.current) return;
      if (visibleRef.current || completingRef.current) return;
      dismissedRef.current = false;
      setPromptVisible(true);
    }, ARRIVAL_REPROMPT_MS);
  }, [setPromptVisible]);

  /**
   * "Confirm": the journey is NOT completed here. The confirmation (dispatch + position within 100 m)
   * is saved and the driver goes to the POD screen; complete-journey runs after the POD upload.
   */
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
    if (!userId) {
      setError('Please sign in again.');
      return;
    }

    completingRef.current = true;
    setCompleting(true);
    setError(null);
    try {
      await savePendingPod({
        userId: String(userId),
        dispatchId: dispatch.dispatchID,
        objectEntryId: String(objectEntryId),
        latitude: at[0],
        longitude: at[1],
        confirmedAt: Date.now(),
      });
      gpsLog('[GlobalArrival] arrival confirmed -> POD screen', { dispatch: dispatch.dispatchID, objectEntryId });
      if (repromptTimerRef.current) clearTimeout(repromptTimerRef.current);
      setPromptVisible(false);
      onArrivalConfirmed(dispatch.dispatchID || String(objectEntryId), objectEntryId);
    } catch (err) {
      gpsWarn('[GlobalArrival] could not save the confirmation', { err: String(err) });
      setError('Could not save the confirmation. Please try again.');
    } finally {
      completingRef.current = false;
      setCompleting(false);
    }
  }, [dispatch, userId, onArrivalConfirmed, setPromptVisible]);

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
            Have you arrived? Tap "Confirm" to upload the proof of delivery. The journey is completed
            after the photo is uploaded.
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
              accessibilityLabel="Confirm arrival and upload proof of delivery"
              style={({ pressed }) => [styles.button, styles.confirm, pressed && styles.dim]}
            >
              {completing ? (
                <ActivityIndicator color={colors.white} />
              ) : (
                <Text style={styles.confirmText}>{error ? 'Try Again' : 'Confirm'}</Text>
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

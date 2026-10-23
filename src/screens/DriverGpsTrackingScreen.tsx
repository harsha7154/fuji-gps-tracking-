import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';

import { AppHeader } from '../components/AppHeader';
import { DriverBottomTabBar, DriverBottomTabKey } from '../components/DriverBottomTabBar';
import { GoogleRouteMap } from '../components/GoogleRouteMap';
import { PrimaryButton } from '../components/PrimaryButton';
import { driverDashboardService } from '../services/driverDashboardService';
import { driverGpsService } from '../services/driverGpsService';
import { getPendingPod, PendingPod, savePendingPod, subscribePendingPod } from '../services/pendingPodService';
import { GpsSocketStatus, GpsWebSocket } from '../services/gpsWebSocketService';
import { GpsLiveSocket, LiveSocketStatus } from '../services/gpsLiveSocketService';
import {
  isBackgroundGpsActive,
  setForegroundPinging,
  startBackgroundGpsTracking,
  stopBackgroundGpsTracking,
} from '../tasks/backgroundGpsTask';
import type { DispatchItem, DispatchPingHistoryItem } from '../types/driverDashboard';
import { ensureForegroundLocationPermission } from '../utils/currentLocation';
import { getDeviceId } from '../utils/deviceId';
import { DISPATCH_STATUS, resolveDispatchStatus } from '../utils/dispatchStatus';
import { arrivalConfirmationService } from '../services/arrivalConfirmationService';
import { StatusAnimation } from '../components/StatusAnimation';
import { gpsFixLog, gpsLog, gpsWarn } from '../utils/gpsLogger';
import { decidePing, HEARTBEAT_MS, LastSentPing, MIN_MOVE_METERS, PING_INTERVAL_MS } from '../utils/pingGate';
import { parseLatLngString } from '../utils/routeGeometry';
import { colors, radius, spacing, typography } from '../theme';

// Reject any GPS fix older than this — guards against Android occasionally
// delivering a cached/stale "last known location" as the first watch
// callback (see the comment above watchPositionAsync below).
const MAX_FIX_AGE_MS = 8000;

// A hung server must never leave the screen on "Loading dispatch..." for minutes.
const LOAD_DEADLINE_MS = 20_000;

// Last resolved dispatch per driver, kept in memory: re-opening the Live GPS tab shows the map
// instantly and the fresh data replaces it a moment later (stale-while-revalidate).
const gpsDispatchCache = new Map<string, { dispatch: DispatchItem; history: [number, number][] }>();

/** A refresh that brings back the same data must not touch the map (no flicker, no route rebuild). */
function sameData(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('DEADLINE')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

// Within this distance of the site the driver is asked "Destination arrived?".
// GPS pings keep going to the WebSocket until the driver taps "Arrived" and
// complete-journey succeeds.
const ARRIVAL_RADIUS_M = 100; // same 100 m as the popup on the other screens (GlobalArrivalPrompt)

// After "Cancel", the confirm popup only comes back once the driver has left the site
// area (moved further than this) and arrived again. Stops GPS jitter at the 100 m edge re-opening it.
const ARRIVAL_EXIT_RADIUS_M = 125;

// "Destination arrived" popup is shown CONTINUOUSLY while the driver is in the arrival zone:
// it opens at <= ARRIVAL_RADIUS_M and keeps coming back (this long after every "Not yet")
// until the driver is farther than ARRIVAL_EXIT_RADIUS_M, or taps "Confirm".
// Works even when the start point and the destination are < 20 m apart.
const ARRIVAL_REPROMPT_MS = 5_000;

// A position read back from the GPS service older than this is not shown as live
// (same 2 minutes as the web tracker's "signal lost").
const SERVER_LIVE_STALE_MS = 120000;

interface ServerLivePosition {
  coord: [number, number];
  heading: number;
  accuracy: number;
  receivedAt: number;
  /** socket = ws/gps/live stream (the only live source; 'rest' is no longer used) */
  source: 'socket' | 'rest';
}

// While the live socket is delivering positions the REST copy is ignored.

const SOCKET_STATUS_LABEL: Record<GpsSocketStatus, string> = {
  idle: 'Idle',
  connecting: 'Connecting...',
  open: 'Connected',
  reconnecting: 'Reconnecting...',
  closed: 'Closed',
};

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function isValidCoord(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    Math.abs(lat) <= 90 && Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/**
 * Stored GPS pings -> [lat, lng] list, oldest first (what the map routes the
 * travelled line through). Sorted by timestamp when every ping has one;
 * otherwise the API order (newest first) is reversed.
 */
function toHistoryCoords(pings: DispatchPingHistoryItem[] | undefined): [number, number][] {
  const valid = (pings ?? []).filter((p) => isValidCoord(p.latitude, p.longitude));
  const allTimed = valid.length > 0 && valid.every((p) => !!p.timestamp);
  const ordered = allTimed
    ? [...valid].sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)))
    : [...valid].reverse();
  return ordered.map((p) => [p.latitude, p.longitude] as [number, number]);
}

interface DriverGpsTrackingScreenProps {
  onBack: () => void;
  onArrivedProceedToPod: (dispatchId?: string, objectEntryId?: number | string) => void;
  onNavigateToProfile?: () => void;
  onNavigateToNotifications?: () => void;
  /** Unread notification count from AppNavigator. */
  notificationCount?: number;
  user?: { id: string };
  accessToken?: string;
  /** Dispatch to track. When omitted, the driver's active dispatch is used (if any). */
  dispatchId?: string;
  /** Known Liferay object entry ID (MaterialDispatchId) to prevent business ID mismatch. */
  initialObjectEntryId?: number | string;
  /** Set to true when arrival was already confirmed by GlobalArrivalPrompt. */
  isInitiallyArrived?: boolean;
  onNavigateToMyTrip?: (dispatchId?: string) => void;
  onNavigateToTripHistory?: () => void;
}

/**
 * Live GPS tracking for ONE dispatch.
 *
 * Flow (per the "Mobile journey" API collection):
 *   1. Resolve the dispatch — dispatches list (when a dispatchId was given) or
 *      GET driver/active-dispatch?userId=, then GET dispatch/{objectEntryId}
 *      for the full record + pingHistory.
 *   2. While In Transit (statusDispatch 1): open the GPS WebSocket
 *      {gpsWs}/ws/gps/mobile/{dispatchId}. The GPS watcher (~2 s) only moves
 *      the map; a ping is sent every PING_INTERVAL_MS (10 s) and ONLY if the
 *      vehicle moved >= 5 m since the last ping, plus a 60 s keep-alive while
 *      parked (see utils/pingGate.ts).
 *   3. Within 100 m of the site: popup "Destination arrived". Pings KEEP going
 *      while it is open and after "Not yet". Only when the driver taps "Arrived":
 *      POST complete-journey, then stop pinging and close the socket.
 *      An arrival hint from the live socket (ws/gps/live) or a "journey completed"
 *      refusal from the socket also ends tracking.
 */
export const DriverGpsTrackingScreen: React.FC<DriverGpsTrackingScreenProps> = ({
  onBack,
  onArrivedProceedToPod,
  onNavigateToProfile,
  onNavigateToNotifications,
  notificationCount,
  user,
  accessToken,
  dispatchId: initialDispatchId,
  initialObjectEntryId,
  isInitiallyArrived = false,
  onNavigateToMyTrip,
  onNavigateToTripHistory,
}) => {
  const [activeTab, setActiveTab] = useState<DriverBottomTabKey>('liveGps');
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState<number>(0);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  const [watchError, setWatchError] = useState<string | null>(null);

  // Dispatch being tracked + its live status.
  const [dispatch, setDispatch] = useState<DispatchItem | null>(null);
  const [statusDispatch, setStatusDispatch] = useState<number | undefined>(
    isInitiallyArrived ? DISPATCH_STATUS.ARRIVED : undefined
  );

  const [currentLiveCoord, setCurrentLiveCoord] = useState<[number, number]>([0, 0]);
  // Stored GPS history of this dispatch (oldest first) — travelled route on the map.
  const [storedHistory, setStoredHistory] = useState<[number, number][]>([]);
  const [accuracy, setAccuracy] = useState<number>(0);
  const [speed, setSpeed] = useState<number>(0);
  const [heading, setHeading] = useState<number>(0);
  // Time of the last ping handed to the GPS server (NOT the last GPS fix).
  const [lastPingAt, setLastPingAt] = useState<number | null>(null);
  const [distanceToSiteM, setDistanceToSiteM] = useState<number | null>(null);

  // WebSocket state.
  const [socketStatus, setSocketStatus] = useState<GpsSocketStatus>('idle');
  const [sentCount, setSentCount] = useState<number>(0);
  const [ackCount, setAckCount] = useState<number>(0);
  const [socketError, setSocketError] = useState<string | null>(null);
  const [gpsServerWarning, setGpsServerWarning] = useState<string | null>(null);

  // Truck position read back from the GPS service (ws/gps/live — what Redis holds).
  const [serverLive, setServerLive] = useState<ServerLivePosition | null>(null);
  const [liveReadStatus, setLiveReadStatus] = useState<LiveSocketStatus>('idle');

  // complete-journey state.
  const [completing, setCompleting] = useState<boolean>(false);
  const [completeError, setCompleteError] = useState<string | null>(null);

  // Arrival confirmation (<= 100 m from the site).
  const [withinArrivalZone, setWithinArrivalZone] = useState<boolean>(false);
  const [arrivalPromptVisible, setArrivalPromptVisible] = useState<boolean>(false);
  // Arrival confirmed, proof of delivery not finished yet (persisted, see pendingPodService).
  const [pendingPod, setPendingPod] = useState<PendingPod | null>(null);
  const podPendingRef = useRef<boolean>(false);
  const repromptTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The token is refreshed periodically by AppNavigator. Reading it through a ref keeps the
  // GPS watcher / socket running across refreshes instead of tearing them down and restarting.
  const accessTokenRef = useRef<string | undefined>(accessToken);
  useEffect(() => {
    accessTokenRef.current = accessToken;
  }, [accessToken]);

  const lastDeviceGpsRef = useRef<[number, number] | null>(null);
  // When ws/gps/live last delivered a position (0 = never).
  const lastLiveSocketAtRef = useRef<number>(0);
  const completingRef = useRef<boolean>(false);
  // true after the driver pressed "Cancel" — reset when they leave the site area.
  const arrivalPromptDismissedRef = useRef<boolean>(false);
  const arrivalDismissedAtRef = useRef<number>(0);
  // true from the first fix inside ARRIVAL_RADIUS_M until the driver is beyond ARRIVAL_EXIT_RADIUS_M.
  const arrivalZoneActiveRef = useRef<boolean>(false);
  const arrivalPromptVisibleRef = useRef<boolean>(false);
  // Position at which the driver was within 100 m (sent as liveGPS on "Arrived").
  const arrivalCoordRef = useRef<[number, number] | null>(null);
  const deviceIdRef = useRef<string | null>(null);
  /**
   * Single gate: ARRIVED status may only be set when this is true.
   * Set to true ONLY when:
   *   • the driver tapped "Confirm" in the popup (completeJourney succeeded), OR
   *   • isInitiallyArrived = true (GlobalArrivalPrompt already got the confirmation).
   * Server/Redis/socket hints NEVER set this — they only show the popup.
   */
  const driverConfirmedArrivalRef = useRef<boolean>(
    isInitiallyArrived || (Boolean(initialDispatchId) && arrivalConfirmationService.isArrivalConfirmed(initialDispatchId))
  );

  useEffect(() => {
    if (isInitiallyArrived && initialDispatchId) {
      arrivalConfirmationService.confirmArrival(initialDispatchId);
    }
  }, [isInitiallyArrived, initialDispatchId]);

  const dispatchKey = dispatch?.dispatchID ?? null;
  const objectEntryId = dispatch?.MaterialDispatchId ?? dispatch?.objectEntryId;
  const isArrived = statusDispatch === DISPATCH_STATUS.ARRIVED;
  const isTracking = dispatchKey !== null && statusDispatch === DISPATCH_STATUS.IN_TRANSIT;
  const hasValidLiveCoord = currentLiveCoord[0] !== 0 && currentLiveCoord[1] !== 0;

  const siteName = dispatch?.siteName || dispatch?.destinationSiteAWC || 'Anganwadi Site';
  const vehicleNumber = dispatch?.vehicleNumber || '';

  const destLat = dispatch?.destinationLatitude || 0;
  const destLng = dispatch?.destinationLongitude || 0;
  const destCoord: [number, number] = destLat !== 0 && destLng !== 0 ? [destLat, destLng] : [0, 0];

  // Plant (start point, red dot): plant coordinates when the API sends them,
  // otherwise the dispatch's start location ("lat, lng").
  const plantPoint =
    dispatch && Number(dispatch.plantLatitude) && Number(dispatch.plantLongitude)
      ? { lat: Number(dispatch.plantLatitude), lng: Number(dispatch.plantLongitude) }
      : parseLatLngString(dispatch?.startLocationGPS);
  const plantLat = plantPoint?.lat ?? 0;
  const plantLng = plantPoint?.lng ?? 0;
  const plantCoord: [number, number] = [plantLat, plantLng];

  // Truck on the map: the position the GPS service stored in Redis, read back over
  // ws/gps/live (same source as the web tracker). Until the socket has delivered a
  // position (service unreachable, socket still connecting, no ping stored yet) the
  // truck is drawn at this phone's own GPS fix — the same fix that is being sent to
  // the GPS service — so it never stays hidden. Once a server position arrives, only
  // server positions move the truck.
  const serverLiveFresh = !!serverLive && Date.now() - serverLive.receivedAt < SERVER_LIVE_STALE_MS;
  const hasDeviceFix = currentLiveCoord[0] !== 0 || currentLiveCoord[1] !== 0;
  const mapLiveCoord: [number, number] = serverLive
    ? serverLive.coord
    : isTracking && hasDeviceFix
      ? currentLiveCoord
      : [0, 0];
  const mapLiveHeading = serverLive ? serverLive.heading : heading;
  const mapLiveAccuracy = serverLive ? serverLive.accuracy : accuracy;

  // Which picture the map draws.
  const mapPhase = isArrived ? 'arrived' : isTracking ? 'inTransit' : 'planned';
  // The map (and its route request) is shown only after "Activate Journey": In Transit or Arrived.
  const isJourneyActivated = isTracking || isArrived;

  // ── 1. Resolve which dispatch we're tracking ────────────────────────────────
  // Speed rules (a slow Liferay used to leave this screen on "Loading dispatch..." for minutes):
  //  * independent requests run in PARALLEL instead of one after another
  //  * the map is shown as soon as the dispatch and its site position are known; the stored GPS
  //    history is fetched afterwards and drawn when it arrives
  //  * the last result is cached in memory, so re-opening the tab is instant and then refreshed
  //  * a hard deadline turns a hung server into an error with a Retry button
  useEffect(() => {
    let isMounted = true;
    const userId = user?.id ? String(user.id) : '';
    const cacheKey = `${userId}|${initialDispatchId ?? ''}`;
    const cached = userId ? gpsDispatchCache.get(cacheKey) : undefined;
    if (cached) {
      setDispatch((prev) => (sameData(prev, cached.dispatch) ? prev : cached.dispatch));
      setStoredHistory((prev) => (sameData(prev, cached.history) ? prev : cached.history));
      // Only trust cached ARRIVED if driver confirmed in this session.
      const cachedStatus =
        driverConfirmedArrivalRef.current && isInitiallyArrived
          ? DISPATCH_STATUS.ARRIVED
          : cached.dispatch.statusDispatch === DISPATCH_STATUS.ARRIVED && !driverConfirmedArrivalRef.current
            ? DISPATCH_STATUS.IN_TRANSIT
            : cached.dispatch.statusDispatch;
      setStatusDispatch(cachedStatus);
      setLoadError(null);
      setLoading(false);
    } else {
      setLoading(true);
      setLoadError(null);
    }

    const matchesInitial = (d: any, _lenient?: boolean): boolean => {
      if (!d || !initialDispatchId) return false;
      if (d.dispatchID === initialDispatchId) return true;
      if (d.dispatchID?.toLowerCase() === initialDispatchId.toLowerCase()) return true;
      if (String(d.objectEntryId) === initialDispatchId) return true;
      if (String(d.MaterialDispatchId) === initialDispatchId) return true;
      if (
        initialObjectEntryId !== undefined &&
        (String(d.MaterialDispatchId) === String(initialObjectEntryId) ||
          String(d.objectEntryId) === String(initialObjectEntryId))
      ) {
        return true;
      }
      return false;
    };

    // The backend marks the driver's own records with driverUserId; another driver's record is never shown.
    const isOwn = (d: any): boolean =>
      d?.driverUserId === undefined || d?.driverUserId === null || d?.driverUserId === '' || String(d.driverUserId) === userId;

    // INSTANT PAINT: GlobalArrivalPrompt / BackgroundGpsController already keep a fresh copy of the
    // driver's active dispatch (site position + stored route). If it is the dispatch we were asked
    // to show, draw from it right now and let the full load below only refresh it.
    let seeded = false;
    if (!cached && userId) {
      const peeked = driverGpsService.peekActiveWithDetail(userId);
      if (peeked && (!initialDispatchId || matchesInitial(peeked, false))) {
        seeded = true;
        setDispatch((prev) => (sameData(prev, peeked) ? prev : peeked));
        const peekedHistory = toHistoryCoords(peeked.pingHistory);
        setStoredHistory((prev) => (sameData(prev, peekedHistory) ? prev : peekedHistory));
        // Only trust peeked ARRIVED if driver confirmed in this session.
        const peekedStatus =
          driverConfirmedArrivalRef.current && isInitiallyArrived
            ? DISPATCH_STATUS.ARRIVED
            : peeked.statusDispatch === DISPATCH_STATUS.ARRIVED && !driverConfirmedArrivalRef.current
              ? DISPATCH_STATUS.IN_TRANSIT
              : peeked.statusDispatch;
        setStatusDispatch(peekedStatus);
        setLoadError(null);
        setLoading(false);
      }
    }
    const hasInstant = Boolean(cached) || seeded;

    // Builds the result from ONE full record (dispatch detail, or active dispatch merged with its detail).
    const fromFullRecord = (base: DispatchItem): { chosen: DispatchItem; history: [number, number][] } => {
      const status = resolveDispatchStatus(base);
      // IMPORTANT: Only trust ARRIVED from the API if the driver has already confirmed in this session
      // (or was navigated here as isInitiallyArrived). A server-side ARRIVED during an active session
      // must go through the popup — never auto-flip the status.
      const effectiveStatus =
        driverConfirmedArrivalRef.current && (isInitiallyArrived || status === DISPATCH_STATUS.ARRIVED)
          ? DISPATCH_STATUS.ARRIVED
          : status === DISPATCH_STATUS.ARRIVED && !driverConfirmedArrivalRef.current
            ? DISPATCH_STATUS.IN_TRANSIT  // keep tracking; popup will fire when GPS puts driver in zone
            : status ?? base.statusDispatch;
      const chosen = {
        ...base,
        statusDispatch: effectiveStatus,
        arrived: (driverConfirmedArrivalRef.current && (isInitiallyArrived || base.arrived)) || false,
      } as DispatchItem;
      return { chosen, history: toHistoryCoords(base.pingHistory) };
    };

    // Only the logged-in driver's ACTIVE dispatch is shown here (otherwise "No active dispatch").
    // Every call goes through the shared caches, so data another screen loaded is reused, not re-asked.
    const resolveOnce = async (): Promise<{ chosen: DispatchItem | null; history: [number, number][] }> => {
      const token = accessTokenRef.current;
      let chosen: DispatchItem | null = null;

      // 1. The driver's own active dispatch with its detail (shared with My Trip, arrival prompt, GPS controller).
      const active = await driverGpsService.getActiveWithDetail(userId, token, 14_000);
      if (active && active.dispatchID && isOwn(active) && (!initialDispatchId || matchesInitial(active))) {
        chosen = active;
      }

      // 2. Opened for a specific dispatch of this driver that is not the "current" one: only if it is
      //    still active (Dispatched / In Transit), or it was just completed and is waiting for its POD.
      if (!chosen && initialDispatchId) {
        const items = await driverDashboardService.getDispatches(userId, token).catch(() => [] as DispatchItem[]);
        const item = items.find((d) => matchesInitial(d)) ?? null;
        const allowed =
          !!item &&
          isOwn(item) &&
          (item.statusDispatch !== DISPATCH_STATUS.ARRIVED || isInitiallyArrived);
        if (item && allowed) {
          const entryId = item.MaterialDispatchId ?? item.objectEntryId;
          const detail =
            entryId !== undefined && String(entryId) !== String(item.dispatchID)
              ? await driverGpsService.fetchDispatchDetail(entryId, userId, token)
              : null;
          chosen = detail && isOwn(detail) ? { ...item, ...detail, objectEntryId: detail.objectEntryId ?? item.objectEntryId } : item;
        }
      }

      if (!chosen) {
        // Nothing came back: either really no active dispatch, or no internet / server / API down.
        if (!(await driverGpsService.isServerReachable(token))) throw new Error('OFFLINE');
        return { chosen: null, history: [] };
      }

      const result = fromFullRecord(chosen);
      if (isInitiallyArrived) {
        result.chosen.statusDispatch = DISPATCH_STATUS.ARRIVED;
        result.chosen.arrived = true;
      }
      return result;
    };

    (async () => {
      try {
        if (!userId) throw new Error('Missing user id');
        console.log('[DriverGpsTrackingScreen] Resolving dispatch for tracking:', {
          initialDispatchId,
          initialObjectEntryId,
          isInitiallyArrived,
          cached: hasInstant,
        });
        const { chosen, history } = await withDeadline(resolveOnce(), LOAD_DEADLINE_MS);
        if (!isMounted) return;
        if (chosen) {
          gpsLog('DISPATCH site location from API', {
            dispatch: chosen.dispatchID,
            objectEntryId: chosen.objectEntryId,
            site: chosen.siteName,
            destinationLatitude: chosen.destinationLatitude,
            destinationLongitude: chosen.destinationLongitude,
            destinationPin: chosen.destinationPin,
            siteMasterObjectEntryId: chosen.siteMasterObjectEntryId,
          });
        }
        if (history.length > 0 || !hasInstant) setStoredHistory((prev) => (sameData(prev, history) ? prev : history));
        // Only mark as ARRIVED from the loaded dispatch if driver already confirmed this session.
        const isConfirmedArrival =
          driverConfirmedArrivalRef.current &&
          (isInitiallyArrived || (Boolean(chosen?.dispatchID) && arrivalConfirmationService.isArrivalConfirmed(chosen?.dispatchID)));
        const resolvedStatus =
          isConfirmedArrival
            ? DISPATCH_STATUS.ARRIVED
            : chosen?.statusDispatch === DISPATCH_STATUS.ARRIVED && !driverConfirmedArrivalRef.current
              ? DISPATCH_STATUS.IN_TRANSIT  // keep tracking; popup will fire at 100 m
              : chosen?.statusDispatch;

        if (chosen) {
          chosen.statusDispatch = resolvedStatus;
          chosen.arrived = resolvedStatus === DISPATCH_STATUS.ARRIVED;
        }
        setDispatch((prev) => (sameData(prev, chosen) ? prev : chosen));
        setStatusDispatch(resolvedStatus);
        console.log('[DriverGpsTrackingScreen] Updated arrival state and POD visibility condition:', {
          dispatchId: chosen?.dispatchID,
          objectEntryId: chosen?.MaterialDispatchId ?? chosen?.objectEntryId,
          statusDispatch: resolvedStatus,
          isArrived: resolvedStatus === DISPATCH_STATUS.ARRIVED,
          renderPodButton: resolvedStatus === DISPATCH_STATUS.ARRIVED,
        });
        if (chosen) gpsDispatchCache.set(cacheKey, { dispatch: chosen, history });
        // The map is already visible: the travelled-route history can arrive a little later.
        if (
          chosen &&
          history.length === 0 &&
          (chosen.statusDispatch === DISPATCH_STATUS.ARRIVED || chosen.statusDispatch === DISPATCH_STATUS.IN_TRANSIT)
        ) {
          const dispatchId = chosen.dispatchID;
          driverGpsService
            .fetchPingHistory(dispatchId, accessTokenRef.current)
            .then((pings) => {
              const coords = toHistoryCoords(pings);
              if (!isMounted || coords.length === 0) return;
              setStoredHistory((prev) => (sameData(prev, coords) ? prev : coords));
              const entry = gpsDispatchCache.get(cacheKey);
              if (entry) gpsDispatchCache.set(cacheKey, { ...entry, history: coords });
            })
            .catch(() => { });
        }
      } catch (err) {
        console.warn('[DriverGpsTrackingScreen] failed to load dispatch:', err);
        // With a cached copy on screen keep showing it; only a first load shows the error.
        if (isMounted && !hasInstant) {
          setLoadError(
            err instanceof Error && err.message === 'OFFLINE'
              ? 'No internet connection, or the server is not responding. Check your connection and tap Retry.'
              : err instanceof Error && err.message === 'DEADLINE'
                ? 'The server is taking too long to respond. Check your connection and tap Retry.'
                : 'Unable to load dispatch details. Tap Retry.'
          );
        }
      } finally {
        if (isMounted) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    })();
    return () => {
      isMounted = false;
    };
  }, [initialDispatchId, initialObjectEntryId, isInitiallyArrived, user?.id, reloadKey]);

  const handleRetryLoad = useCallback(() => {
    driverGpsService.invalidateCaches();
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }, []);
  const handlePullRefresh = useCallback(() => {
    driverGpsService.invalidateCaches();
    setRefreshing(true);
    setReloadKey((k) => k + 1);
  }, []);

  // ── complete-journey (only after the driver confirms in the arrival popup) ──
  // Pending proof of delivery for this driver + dispatch: no popup, "Continue" button instead.
  useEffect(() => {
    const uid = user?.id;
    if (!uid || !dispatchKey) {
      podPendingRef.current = false;
      setPendingPod(null);
      return;
    }
    const apply = (p: PendingPod | null) => {
      const mine = p && p.dispatchId === dispatchKey ? p : null;
      podPendingRef.current = Boolean(mine);
      setPendingPod(mine);
      if (mine) {
        arrivalPromptVisibleRef.current = false;
        setArrivalPromptVisible(false);
      }
    };
    let active = true;
    getPendingPod(uid).then((p) => {
      if (active) apply(p);
    });
    const unsub = subscribePendingPod((changedUser, p) => {
      if (changedUser === String(uid)) apply(p);
    });
    return () => {
      active = false;
      unsub();
    };
  }, [user?.id, dispatchKey]);

  useEffect(() => () => {
    if (repromptTimerRef.current) clearTimeout(repromptTimerRef.current);
  }, []);

  /**
   * "Confirm" in the arrival popup: the journey is NOT completed here. The confirmation (dispatch +
   * position within 100 m) is saved and the driver goes to the POD screen. complete-journey runs
   * only after the POD photo is uploaded (AppNavigator.handleDriverPodSubmit).
   */
  const confirmArrivalForPod = useCallback(
    async (coord?: [number, number] | null) => {
      if (completingRef.current) return;
      if (objectEntryId === undefined || !dispatchKey) {
        setCompleteError('This dispatch is missing its ID (MaterialDispatchId). Please go back and reopen it.');
        return;
      }
      const at = coord ?? lastDeviceGpsRef.current;
      if (!at) {
        setCompleteError('Waiting for a GPS fix...');
        return;
      }
      if (!user?.id) {
        setCompleteError('Please sign in again.');
        return;
      }

      completingRef.current = true;
      setCompleting(true);
      setCompleteError(null);
      try {
        await savePendingPod({
          userId: user.id,
          dispatchId: dispatchKey,
          objectEntryId: String(objectEntryId),
          latitude: at[0],
          longitude: at[1],
          confirmedAt: Date.now(),
        });
        gpsLog('ARRIVAL confirmed -> POD screen (journey completes after the POD upload)', {
          dispatch: dispatchKey,
          objectEntryId,
        });
        if (repromptTimerRef.current) clearTimeout(repromptTimerRef.current);
        arrivalPromptVisibleRef.current = false;
        setArrivalPromptVisible(false);
        onArrivedProceedToPod(dispatchKey, objectEntryId);
      } catch (err) {
        gpsWarn('ARRIVAL confirm could not be saved', { err: err instanceof Error ? err.message : String(err) });
        setCompleteError('Could not save the confirmation. Please try again.');
      } finally {
        completingRef.current = false;
        setCompleting(false);
      }
    },
    [objectEntryId, dispatchKey, user?.id, onArrivedProceedToPod]
  );

  // Popup buttons.
  const handleConfirmArrival = useCallback(() => {
    console.log('[DriverGpsTrackingScreen] Immediately before arrival confirmation callback:', {
      selectedDispatchId: dispatchKey,
      objectEntryId,
      distanceToSiteM,
      withinArrivalZone,
      arrivalCoord: arrivalCoordRef.current,
      isArrived,
      statusDispatch,
      navigationDecision: 'User confirmed arrival in popup; opening POD upload (complete-journey after upload)',
    });
    gpsLog('ARRIVAL-POPUP driver tapped CONFIRM -> POD upload', {
      dispatch: dispatchKey,
      objectEntryId,
    });
    confirmArrivalForPod(arrivalCoordRef.current ?? lastDeviceGpsRef.current);
  }, [confirmArrivalForPod, dispatchKey, distanceToSiteM, isArrived, objectEntryId, statusDispatch, withinArrivalZone]);

  const handleCancelArrival = useCallback(() => {
    if (completingRef.current) return;
    arrivalPromptDismissedRef.current = true;
    arrivalDismissedAtRef.current = Date.now();
    arrivalPromptVisibleRef.current = false;
    setArrivalPromptVisible(false);
    setCompleteError(null);
    if (dispatchKey) arrivalConfirmationService.markInTransit(dispatchKey);
    gpsLog('ARRIVAL-POPUP driver tapped NOT YET -> asking again in 5 s', { dispatch: dispatchKey });
    // Ask again after ARRIVAL_REPROMPT_MS even if no new GPS fix arrives (truck standing still).
    if (repromptTimerRef.current) clearTimeout(repromptTimerRef.current);
    repromptTimerRef.current = setTimeout(() => {
      repromptTimerRef.current = null;
      if (!arrivalPromptDismissedRef.current || podPendingRef.current || completingRef.current) return;
      if (!arrivalZoneActiveRef.current || arrivalPromptVisibleRef.current) return;
      arrivalPromptDismissedRef.current = false;
      arrivalPromptVisibleRef.current = true;
      setArrivalPromptVisible(true);
    }, ARRIVAL_REPROMPT_MS);
  }, [dispatchKey]);

  // "Complete Journey" button shown while at the site after Cancel.
  const openArrivalPrompt = useCallback(() => {
    setCompleteError(null);
    arrivalPromptVisibleRef.current = true;
    setArrivalPromptVisible(true);
  }, []);

  // The GPS server can say "journey closed / arrived" over a socket. A socket message is only a HINT.
  // We NEVER auto-complete the journey — the driver must tap "Confirm" in the arrival popup.
  // This callback checks the server, and if it confirms arrival it shows the popup so the driver
  // can choose to confirm manually. complete-journey is ONLY ever called from handleConfirmArrival.
  const confirmServerArrival = useCallback(
    async (source: string) => {
      if (!dispatchKey) return;
      // The hint comes from the GPS WebSocket (ws/gps/live). No Liferay call here:
      // complete-journey itself checks the 100 m rule when the driver confirms.
      const recentlyDismissed =
        arrivalPromptDismissedRef.current &&
        Date.now() - arrivalDismissedAtRef.current < ARRIVAL_REPROMPT_MS;
      gpsLog('ARRIVAL hint (' + source + ')', { dispatch: dispatchKey, recentlyDismissed });
      if (!completingRef.current && !arrivalPromptVisibleRef.current && !recentlyDismissed && !podPendingRef.current) {
        gpsLog('ARRIVAL hint -> showing popup for driver confirmation (no auto-complete)', { source });
        arrivalPromptVisibleRef.current = true;
        setArrivalPromptVisible(true);
      }
    },
    [dispatchKey]
  );
  const confirmServerArrivalRef = useRef(confirmServerArrival);
  confirmServerArrivalRef.current = confirmServerArrival;

  // ── 2. While In Transit: stream GPS over the WebSocket + watch for arrival ──
  // Runs ONLY when statusDispatch === 1. On arrival this effect's cleanup closes
  // the socket and stops the GPS watch.
  useEffect(() => {
    if (!isTracking || !dispatchKey) return;

    let isMounted = true;
    let subscription: Location.LocationSubscription | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let socket: GpsWebSocket | null = null;

    // Per-session counters, printed as a summary when tracking stops.
    const stats = { fixes: 0, stale: 0, sent: 0, queued: 0, skipped: 0, acked: 0, errors: 0, startedAt: Date.now() };

    arrivalZoneActiveRef.current = false;

    gpsLog('TRACK-START', {
      dispatch: dispatchKey,
      vehicle: vehicleNumber,
      dest: `${destLat},${destLng}`,
      pingEveryMs: PING_INTERVAL_MS,
      minMoveM: MIN_MOVE_METERS,
      heartbeatMs: HEARTBEAT_MS,
    });

    // Within 100 m -> ask "Destination arrived?" (no API call until the driver presses "Arrived").
    const checkArrival = (meters: number, coord: [number, number] | null) => {
      if (!Number.isFinite(meters)) return;

      // Enter the zone at <= 100 m; once inside, STAY inside until farther than 125 m.
      const inZone = meters <= ARRIVAL_RADIUS_M || (arrivalZoneActiveRef.current && meters <= ARRIVAL_EXIT_RADIUS_M);

      if (inZone) {
        if (!arrivalZoneActiveRef.current) {
          arrivalZoneActiveRef.current = true;
          gpsLog('ARRIVAL-ZONE entered', { distM: Math.round(meters), enterM: ARRIVAL_RADIUS_M, leaveM: ARRIVAL_EXIT_RADIUS_M });
        }
        if (coord) arrivalCoordRef.current = coord;
        setWithinArrivalZone(true);

        // After "Not yet", ask again once ARRIVAL_REPROMPT_MS has passed and the driver is still in the zone.
        if (
          arrivalPromptDismissedRef.current &&
          Date.now() - arrivalDismissedAtRef.current >= ARRIVAL_REPROMPT_MS
        ) {
          arrivalPromptDismissedRef.current = false;
        }

        if (
          !arrivalPromptDismissedRef.current &&
          !arrivalPromptVisibleRef.current &&
          !completingRef.current &&
          !podPendingRef.current
        ) {
          gpsLog('ARRIVAL-POPUP shown', { distM: Math.round(meters), radiusM: ARRIVAL_RADIUS_M, dispatch: dispatchKey });
          arrivalPromptVisibleRef.current = true;
          setArrivalPromptVisible(true);
        }
      } else {
        // Farther than 75 m: left the site area. Popup stops; the next arrival asks again.
        if (arrivalZoneActiveRef.current) {
          gpsLog('ARRIVAL-ZONE left', { distM: Math.round(meters), leaveM: ARRIVAL_EXIT_RADIUS_M });
        }
        arrivalZoneActiveRef.current = false;
        setWithinArrivalZone(false);
        arrivalPromptDismissedRef.current = false;
        if (arrivalPromptVisibleRef.current && !completingRef.current) {
          arrivalPromptVisibleRef.current = false;
          setArrivalPromptVisible(false);
        }
      }
    };

    (async () => {
      const granted = await ensureForegroundLocationPermission();
      if (!isMounted) return;
      if (!granted) {
        gpsWarn('PERMISSION denied - GPS pings will NOT be sent');
        setPermissionError('Location permission denied. Please grant location access in device Settings.');
        return;
      }
      gpsLog('PERMISSION granted');
      setPermissionError(null);

      const deviceId = await getDeviceId();
      if (!isMounted) return;
      deviceIdRef.current = deviceId;
      gpsLog('DEVICE-ID', { deviceId });

      // GPS service health ({gpsHttp}/health) — informational only.
      driverGpsService.checkGpsServiceHealth().then((health) => {
        if (!isMounted) return;
        if (!health) {
          gpsWarn('HEALTH unreachable - GPS server (port 8070) did not answer /health');
          return;
        }
        gpsLog('HEALTH', { status: health.status, redis: health.redis, openConnections: health.openConnections });
        if (health.status !== 'UP' || (health.redis && health.redis !== 'UP')) {
          setGpsServerWarning(`GPS server status: ${health.status}, Redis: ${health.redis ?? 'unknown'}`);
        } else {
          setGpsServerWarning(null);
        }
      });

      // {gpsWs}/ws/gps/mobile/{dispatchId}
      socket = new GpsWebSocket(
        { dispatchId: dispatchKey, deviceId, vehicleId: vehicleNumber },
        {
          onStatusChange: (s) => isMounted && setSocketStatus(s),
          onAccepted: (n) => {
            if (!isMounted) return;
            stats.acked += n;
            setAckCount((c) => c + n);
            setSocketError(null);
          },
          onError: (e) => {
            stats.errors += 1;
            if (isMounted) setSocketError(`${e.code}: ${e.message}`);
          },
          onJourneyClosed: (e) => {
            gpsLog('JOURNEY-CLOSED hint from the ping socket', { code: e.code, message: e.message });
            if (isMounted) void confirmServerArrivalRef.current('ping-socket');
          },
        }
      );
      socket.connect();

      // ── Ping gate (state lives only for this tracking session) ──────────
      // Latest valid fix: refreshed by the watcher (~2 s) for the map; read by
      // the 10 s timer to decide whether to ping.
      let latestFix: {
        latitude: number;
        longitude: number;
        accuracy: number;
        speed: number;
        heading: number;
        timestamp: number;
      } | null = null;

      // Last ping handed to the socket. Only updated when the socket accepted it
      // (sent now, or queued for the reconnect flush), never on 'dropped'.
      let lastSent: LastSentPing | null = null;
      let firstFixHandled = false;

      const sendPingIfNeeded = () => {
        const fix = latestFix;
        if (!isMounted || !fix || !socket) return;

        // App is minimised and the background service is running: IT sends the pings
        // (tasks/backgroundGpsTask.ts). Skipping here avoids duplicate pings.
        if (AppState.currentState !== 'active' && isBackgroundGpsActive()) return;

        const decision = decidePing(fix, lastSent, Date.now());
        const sinceLastSentSec = lastSent ? Math.round((Date.now() - lastSent.sentAt) / 1000) : null;
        if (!decision.send) {
          stats.skipped += 1;
          gpsLog('GATE skip (same position)', {
            movedM: Number(decision.movedMeters.toFixed(1)),
            minMoveM: MIN_MOVE_METERS,
            sinceLastSentSec,
            heartbeatInSec: lastSent ? Math.max(0, Math.round((HEARTBEAT_MS - (Date.now() - lastSent.sentAt)) / 1000)) : null,
          });
          return;
        }

        const result = socket.send({
          latitude: fix.latitude,
          longitude: fix.longitude,
          accuracy: fix.accuracy,
          speed: fix.speed,
          heading: fix.heading,
          // A keep-alive for a parked vehicle is stamped "now"; otherwise use the fix time.
          timestamp: decision.reason === 'heartbeat' ? Date.now() : fix.timestamp,
        });
        if (result === 'dropped') {
          gpsWarn('PING dropped (socket permanently closed)', { reason: decision.reason });
          return;
        }

        lastSent = { latitude: fix.latitude, longitude: fix.longitude, sentAt: Date.now() };
        if (result === 'sent') stats.sent += 1;
        else stats.queued += 1;
        setSentCount((c) => c + 1);
        setLastPingAt(lastSent.sentAt);
        gpsLog(`PING ${result.toUpperCase()}`, {
          n: stats.sent + stats.queued,
          reason: decision.reason,
          lat: fix.latitude,
          lng: fix.longitude,
          acc: Math.round(fix.accuracy),
          speedMps: Number(fix.speed.toFixed(1)),
          movedM: Number(decision.movedMeters.toFixed(1)),
          sinceLastSentSec,
          fixAgeSec: Math.round((Date.now() - fix.timestamp) / 1000),
          socket: socket.getStatus(),
          queued: socket.getQueuedCount(),
        });
      };

      // NOTE: we deliberately do NOT call getCurrentPositionAsync() for an
      // "instant" fix here. On Android it commonly returns the OS's cached
      // last-known/fused location instead of a fresh GPS reading. We only trust
      // fixes from the continuous watch below and reject stale ones.
      try {
        gpsLog('WATCH-START', { accuracy: 'BestForNavigation', timeIntervalMs: 2000, distanceIntervalM: 1 });
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.BestForNavigation,
            timeInterval: 2000,
            distanceInterval: 1,
          },
          (position) => {
            if (!isMounted) return;

            const fixAgeMs = Date.now() - position.timestamp;
            if (fixAgeMs > MAX_FIX_AGE_MS) {
              stats.stale += 1;
              gpsWarn('FIX discarded (stale)', { ageMs: fixAgeMs, maxMs: MAX_FIX_AGE_MS });
              return;
            }

            const { latitude, longitude, accuracy: acc, speed: spd, heading: hdg } = position.coords;
            const newCoord: [number, number] = [latitude, longitude];

            stats.fixes += 1;
            gpsFixLog('FIX', {
              n: stats.fixes,
              lat: latitude,
              lng: longitude,
              acc: Math.round(acc ?? 0),
              speedMps: Number((spd ?? 0).toFixed(1)),
              heading: Math.round(hdg ?? 0),
              ageMs: fixAgeMs,
            });

            lastDeviceGpsRef.current = newCoord;
            setCurrentLiveCoord(newCoord);
            setAccuracy(acc ?? 0);
            setSpeed(spd ?? 0);
            setHeading(hdg ?? 0);

            // Only STORE the fix here. Sending is done by the 10 s ping timer
            // below, and only if the position changed (utils/pingGate.ts).
            latestFix = {
              latitude,
              longitude,
              accuracy: acc ?? 0,
              speed: spd ?? 0,
              heading: hdg ?? 0,
              timestamp: position.timestamp,
            };

            // First valid fix of this session: ping right away instead of
            // making the server wait up to 10 s for the first position.
            if (!firstFixHandled) {
              firstFixHandled = true;
              sendPingIfNeeded();
            }

            // Local arrival check from the device's own fix.
            if (destLat !== 0 && destLng !== 0) {
              const meters = haversineKm(latitude, longitude, destLat, destLng) * 1000;
              setDistanceToSiteM(meters);
              checkArrival(meters, newCoord);
            }
          }
        );

        if (!isMounted) {
          sub.remove();
          return;
        }
        subscription = sub;
      } catch (err) {
        gpsWarn('WATCH-ERROR location watch failed - NO pings will be sent', { err: String(err) });
        if (isMounted) {
          setWatchError(err instanceof Error ? err.message : 'Failed to start GPS watch');
        }
      }

      // Screen closed while the watcher was starting: cleanup already ran, so don't start timers.
      if (!isMounted) return;
      gpsLog('TIMER-START ping gate', { everyMs: PING_INTERVAL_MS });

      // Every 10 s: ping if the vehicle moved since the last ping (or heartbeat is due).
      pingTimer = setInterval(sendPingIfNeeded, PING_INTERVAL_MS);

      // Live position comes ONLY from the GPS WebSocket API (ws/gps/live, effect below).
      // No Liferay API is polled for the live location or its status.
    })();

    return () => {
      isMounted = false;
      gpsLog('TRACK-STOP summary', {
        dispatch: dispatchKey,
        runSec: Math.round((Date.now() - stats.startedAt) / 1000),
        fixes: stats.fixes,
        staleFixes: stats.stale,
        pingsSent: stats.sent,
        pingsQueuedOffline: stats.queued,
        gateSkipped: stats.skipped,
        serverAcks: stats.acked,
        serverErrors: stats.errors,
      });
      subscription?.remove();
      if (pingTimer) clearInterval(pingTimer);
      socket?.close();
      setSocketStatus('closed');
    };
  }, [isTracking, dispatchKey, vehicleNumber, destLat, destLng]);

  // ── 2b. Keep pinging when the app is minimised / closed ─────────────────────
  // While the app is open on this screen, the effect above sends the pings. The
  // background service (foreground service + notification, see
  // tasks/backgroundGpsTask.ts) is started here and takes over by itself as soon
  // as the app is hidden or closed. It is NOT stopped when this screen closes —
  // the journey is still running; it stops on arrival (below), logout, or when
  // the server reports the journey as completed.
  useEffect(() => {
    if (!isTracking || !dispatchKey) return;

    let cancelled = false;
    setForegroundPinging(true);

    (async () => {
      const granted = await ensureForegroundLocationPermission();
      if (!granted || cancelled) return;
      const deviceId = deviceIdRef.current ?? (await getDeviceId());
      if (cancelled) return;
      const started = await startBackgroundGpsTracking({
        dispatchId: dispatchKey,
        vehicleNumber,
        deviceId,
        destLat: Number(destLat) || 0,
        destLng: Number(destLng) || 0,
      });
      gpsLog('BG-TRACKING', { started, dispatch: dispatchKey });
    })();

    return () => {
      cancelled = true;
      // Screen closed (or journey ended): hand pinging over to the background service.
      setForegroundPinging(false);
    };
  }, [isTracking, dispatchKey, vehicleNumber, destLat, destLng]);

  // Journey arrived / completed -> stop the background service.
  useEffect(() => {
    if (isArrived) {
      stopBackgroundGpsTracking('arrived').catch(() => { });
    }
  }, [isArrived]);

  // ── Read the live position back from the GPS service (Redis) ────────────────
  //   ws://<host>:8070/ws/gps/live/{dispatchId}
  //
  //   Only opened when the GPS service supports this endpoint (health check
  //   returns a "liveEndpoint" field). Old server builds don't have it, which
  //   causes the "WebSocket connection failed" console error. There is no
  //   Liferay fallback: the live location comes from this socket only.
  useEffect(() => {
    if (!isTracking || !dispatchKey) return;

    let isMounted = true;
    let live: GpsLiveSocket | null = null;
    // Time of the newest position shown, so an older snapshot never moves the truck back.
    let newestPositionTs = 0;

    // Opened straight away, like the web Dispatch Tracker. It used to wait for /health to
    // advertise "liveEndpoint"; a GPS service without that field (but with /ws/gps/live)
    // never got a socket, so the truck was never drawn. GpsLiveSocket retries / backs off
    // by itself while the service or network is down; the truck stays at the last position.
    const connectLive = () => {
      if (!isMounted) return;
      live = new GpsLiveSocket(dispatchKey, {
        onStatusChange: (status) => {
          gpsLog('LIVE-READ socket', { status });
          setLiveReadStatus(status);
        },
        onPosition: (p, fromSnapshot) => {
          // The snapshot is the last ping the GPS service has: shown even when it is old
          // (truck parked / phone offline), but never over a newer position.
          if (p.ts && p.ts < newestPositionTs) return;
          if (p.ts) newestPositionTs = p.ts;
          gpsLog('LIVE-READ position (server copy) -> map', { lat: p.lat, lng: p.lng, snapshot: fromSnapshot });
          lastLiveSocketAtRef.current = Date.now();
          setServerLive({
            coord: [p.lat, p.lng],
            heading: p.heading,
            accuracy: p.accuracy,
            receivedAt: Date.now(),
            source: 'socket',
          });
        },
        onArrived: () => {
          gpsLog('ARRIVAL hint from the live socket', { dispatch: dispatchKey });
          if (isMounted) void confirmServerArrivalRef.current('live-socket');
        },
      });
      live.connect();
    };
    connectLive();

    return () => {
      isMounted = false;
      live?.close();
      lastLiveSocketAtRef.current = 0;
      setServerLive(null);
      setLiveReadStatus('idle');
    };
  }, [isTracking, dispatchKey]);

  const handleTabPress = useCallback(
    (tab: DriverBottomTabKey) => {
      setActiveTab(tab);
      if (tab === 'dashboard') {
        onBack();
        return;
      }
      if (tab === 'myTrip') {
        onNavigateToMyTrip?.(dispatch?.dispatchID);
        return;
      }
      if (tab === 'liveGps') return;
      if (tab === 'history') {
        onNavigateToTripHistory?.();
        return;
      }
      if (tab === 'profile') {
        onNavigateToProfile?.();
        return;
      }
    },
    [onBack, onNavigateToProfile, onNavigateToMyTrip, onNavigateToTripHistory, dispatch?.dispatchID]
  );

  const lastUpdateLabel = lastPingAt
    ? new Date(lastPingAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '--:--:--';

 
  const renderMapContent = () => {
    if (loadError && !dispatch) {
      return (
        <View style={styles.loadingContainer}>
          <Ionicons name="cloud-offline-outline" size={28} color={colors.textSecondary} />
          <Text style={styles.emptyStateText}>{loadError}</Text>
          <Pressable onPress={handleRetryLoad} hitSlop={8} style={{ marginTop: 12, paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: colors.primary }}>
            <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Retry</Text>
          </Pressable>
        </View>
      );
    }
    if (!loading && dispatch && destCoord[0] === 0 && plantLat === 0 && storedHistory.length === 0) {
      return (
        <View style={styles.loadingContainer}>
          <Ionicons name="map-outline" size={28} color={colors.textSecondary} />
          <Text style={styles.emptyStateText}>
            The plant and site locations are not set for this dispatch, so the route cannot be shown.
          </Text>
        </View>
      );
    }

    // No dispatch yet (still loading) or no trip in transit: a PLAIN map, no route, no Google Routes API request.
    // The route appears as soon as the dispatch is known / after the driver taps "Activate Journey".
    return (
      <View style={styles.plainMapWrap}>
        {dispatch ? (
          <GoogleRouteMap
            dispatchKey={dispatch.dispatchID}
            phase={mapPhase}
            plantCoord={plantCoord}
            destCoord={destCoord}
            liveCoord={mapLiveCoord}
            liveHeading={mapLiveHeading}
            liveAccuracy={mapLiveAccuracy}
            historyCoords={storedHistory}
            plantLabel={dispatch.plantName}
            destLabel={siteName}
            vehicleNumber={vehicleNumber}
          />
        ) : (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={styles.emptyStateText}>Loading dispatch…</Text>
          </View>
        )}
        {loading && dispatch && !refreshing ? (
          <View style={styles.mapLoadingBadge} pointerEvents="none">
            <ActivityIndicator size="small" color="#FFFFFF" />
            <Text style={styles.mapLoadingBadgeText}>Loading dispatch…</Text>
          </View>
        ) : null}
        {!loading && !dispatch ? (
          <View style={styles.plainMapHint} pointerEvents="none">
            <Text style={styles.plainMapHintText}>
              No journey is active. Tap "Activate Journey" on the dashboard to start live tracking.
            </Text>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handlePullRefresh} colors={[colors.primary]} />}
      >
        <AppHeader
          variant="curved"
          logoWidth={130}
          notificationCount={notificationCount ?? 0}
          notificationBadgeColor="#0B5FA8"
          onNotificationPress={onNavigateToNotifications}
          avatarIcon="person"
          avatarIconColor="#D97706"
          avatarBackgroundColor="#FEF3D6"
          onAvatarPress={onNavigateToProfile}
        />

        <View style={styles.content}>
          <Pressable
            onPress={onBack}
            hitSlop={8}
            style={({ pressed }) => [styles.backLink, pressed && styles.backLinkPressed]}
            accessibilityRole="button"
            accessibilityLabel="Back to Dashboard"
          >
            <Ionicons name="chevron-back" size={16} color="#0B5FA8" />
            <Text style={styles.backLinkText}>Back to Dashboard</Text>
          </Pressable>

          {dispatch ? (
          <>
          <View style={styles.titleRow}>
            <View style={styles.headerTitleBlock}>
              <Text style={styles.title}>Live GPS Tracking</Text>
              <Text style={styles.titleSubtext}>
                {dispatch ? `${dispatch.dispatchID} • ${vehicleNumber || '—'}` : '—'}
              </Text>
            </View>
            <View style={[styles.moduleBadge, isArrived && styles.moduleBadgeArrived]}>
              <Text style={[styles.moduleBadgeText, isArrived && styles.moduleBadgeTextArrived]}>
                {isArrived
                  ? 'ARRIVED'
                  : isTracking
                    ? 'LIVE IN TRANSIT'
                    : statusDispatch === DISPATCH_STATUS.DISPATCHED
                      ? 'NOT STARTED'
                      : 'NOT TRACKING'}
              </Text>
            </View>
          </View>

          {permissionError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="warning" size={16} color="#b91c1c" />
              <Text style={styles.errorBannerText}>{permissionError}</Text>
            </View>
          ) : null}

          {gpsServerWarning ? (
            <View style={styles.errorBanner}>
              <Ionicons name="warning" size={16} color="#b91c1c" />
              <Text style={styles.errorBannerText}>{gpsServerWarning}</Text>
            </View>
          ) : null}

          {watchError ? (
            <View style={styles.errorBanner}>
              <Ionicons name="warning" size={16} color="#b91c1c" />
              <Text style={styles.errorBannerText}>GPS error: {watchError}</Text>
            </View>
          ) : null}
          </>
          ) : null}

          {!dispatch && loading ? (
            <StatusAnimation kind="loading" title="Loading your dispatch…" />
          ) : !dispatch && loadError ? (
            <StatusAnimation
              kind="offline"
              title="Can't reach the server"
              message={loadError}
              onRetry={handleRetryLoad}
            />
          ) : !dispatch ? (
            <View style={styles.noDispatchCard}>
              <Ionicons name="navigate-circle-outline" size={44} color={colors.textSecondary} />
              <Text style={styles.noDispatchTitle}>No active dispatch</Text>
              <Text style={styles.emptyStateText}>
                You have no dispatch in progress. Live GPS appears here when a dispatch assigned to you is active.
              </Text>
            </View>
          ) : (
          <>
          {/* ── Route Info Header Card ── */}
          <View style={styles.routeHeaderCard}>
            {dispatch?.plantName ? (
              <>
                <View style={styles.routeLeg}>
                  <View style={[styles.routeDot, styles.routeDotPlant]} />
                  <View style={styles.routeLegText}>
                    <Text style={styles.routeLegLabel}>PLANT (START)</Text>
                    <Text style={styles.routeLegVal}>{dispatch.plantName}</Text>
                  </View>
                </View>
                <View style={styles.routeDivider} />
              </>
            ) : null}
            <View style={styles.routeLeg}>
              <View style={[styles.routeDot, styles.routeDotSite]} />
              <View style={styles.routeLegText}>
                <Text style={styles.routeLegLabel}>SITE (DESTINATION)</Text>
                <Text style={styles.routeLegVal}>{siteName}</Text>
                {/* Exactly what the dispatch API returned: this is where the green dot is drawn. */}
                <Text style={styles.routeLegCoords}>
                  {destLat !== 0 && destLng !== 0 ? `${destLat.toFixed(6)}, ${destLng.toFixed(6)}` : 'Location not set'}
                </Text>
              </View>
            </View>
          </View>

          {/* ── Map: plant (red) / site (green) / truck, travelled gray, remaining blue ──
               Only after the journey is activated; before that a short hint replaces it. */}
          {isJourneyActivated ? (
            <View style={styles.mapCard}>
              {renderMapContent()}
            </View>
          ) : (
            <View style={styles.noDispatchCard}>
              <Ionicons name="map-outline" size={44} color={colors.textSecondary} />
              <Text style={styles.noDispatchTitle}>Journey not started</Text>
              <Text style={styles.emptyStateText}>
                The live map appears once you tap "Activate Journey" on the dashboard for this dispatch.
              </Text>
            </View>
          )}

          {/* ── Telemetry Stats Card ── */}
          <View style={styles.telemetryCard}>
            <View style={styles.telemetryRow}>
              <Text style={styles.telemetryLabel}>Live Latitude / Longitude</Text>
              <Text style={styles.telemetryValue}>
                {hasValidLiveCoord ? `${currentLiveCoord[0].toFixed(5)}, ${currentLiveCoord[1].toFixed(5)}` : '--'}
              </Text>
            </View>
            <View style={styles.telemetryRow}>
              <Text style={styles.telemetryLabel}>Speed / Heading</Text>
              <Text style={styles.telemetryValue}>
                {(speed * 3.6).toFixed(1)} km/h ({heading.toFixed(0)}°)
              </Text>
            </View>
            <View style={styles.telemetryRow}>
              <Text style={styles.telemetryLabel}>Distance to Site</Text>
              <Text style={styles.telemetryValue}>
                {isArrived ? 'Arrived' : distanceToSiteM !== null ? formatDistance(distanceToSiteM) : '--'}
              </Text>
            </View>
            <View style={styles.telemetryRow}>
              <Text style={styles.telemetryLabel}>Last Location Sent</Text>
              <Text style={styles.telemetryValue}>{lastUpdateLabel}</Text>
            </View>
            <View style={styles.telemetryRow}>
              <Text style={styles.telemetryLabel}>GPS Server (WebSocket)</Text>
              <Text
                style={[
                  styles.telemetryValue,
                  socketStatus === 'open' ? styles.socketOk : socketStatus === 'reconnecting' ? styles.socketWarn : null,
                ]}
              >
                {SOCKET_STATUS_LABEL[socketStatus]}
              </Text>
            </View>
            <View style={styles.telemetryRow}>
              <Text style={styles.telemetryLabel}>Map Position From</Text>
              <Text
                style={[
                  styles.telemetryValue,
                  serverLiveFresh ? styles.socketOk : liveReadStatus === 'reconnecting' ? styles.socketWarn : null,
                ]}
              >
                {!isTracking
                  ? '--'
                  : serverLiveFresh && serverLive
                    ? serverLive.source === 'socket'
                      ? 'GPS Server (Redis, live socket)'
                      : 'GPS Server (Redis, via API)'
                    : serverLive
                      ? 'Last GPS position (waiting for live update)'
                      : liveReadStatus === 'open'
                        ? 'Waiting for GPS Server'
                        : 'GPS Server not connected'}
              </Text>
            </View>
            <View style={styles.telemetryRow}>
              <Text style={styles.telemetryLabel}>Locations Sent / Acknowledged</Text>
              <Text style={styles.telemetryValue}>
                {sentCount} / {ackCount}
              </Text>
            </View>
            {socketError ? <Text style={styles.socketErrorText}>{socketError}</Text> : null}
          </View>

          {isArrived ? (
            <PrimaryButton
              label="Proceed to Proof of Delivery (POD) →"
              onPress={() => {
                const targetDispatchId = dispatch?.dispatchID || initialDispatchId;
                const targetObjectEntryId =
                  dispatch?.MaterialDispatchId ??
                  (dispatch?.objectEntryId !== undefined &&
                   String(dispatch?.objectEntryId) !== String(dispatch?.dispatchID) &&
                   !String(dispatch?.objectEntryId).toUpperCase().startsWith('DSP-') &&
                   /^\d+$/.test(String(dispatch?.objectEntryId))
                    ? dispatch.objectEntryId
                    : (initialObjectEntryId !== undefined &&
                       !String(initialObjectEntryId).toUpperCase().startsWith('DSP-') &&
                       /^\d+$/.test(String(initialObjectEntryId))
                        ? initialObjectEntryId
                        : undefined));
                console.log('[DriverGpsTrackingScreen] Navigation decision: Proceed to POD button tapped', {
                  selectedDispatchId: targetDispatchId,
                  objectEntryId: targetObjectEntryId,
                  statusDispatch,
                  isArrived,
                  navigationDecision: 'Proceeding to DriverPod screen with verified dispatch and objectEntryId',
                });
                onArrivedProceedToPod(targetDispatchId, targetObjectEntryId);
              }}
              style={styles.proceedButton}
            />
          ) : pendingPod ? (
            <View style={styles.atSiteCard}>
              <View style={styles.atSiteHeader}>
                <Ionicons name="camera" size={18} color={colors.statGreenIcon} />
                <Text style={styles.atSiteTitle}>Proof of delivery pending</Text>
              </View>
              <Text style={styles.atSiteText}>
                Upload the proof of delivery photo to complete this journey. Live GPS keeps running until then.
              </Text>
              <PrimaryButton
                label="Continue to Proof of Delivery (POD) →"
                onPress={() => onArrivedProceedToPod(pendingPod.dispatchId, pendingPod.objectEntryId)}
                style={styles.atSiteButton}
              />
            </View>
          ) : isTracking && withinArrivalZone ? (
            <View style={styles.atSiteCard}>
              <View style={styles.atSiteHeader}>
                <Ionicons name="flag" size={18} color={colors.statGreenIcon} />
                <Text style={styles.atSiteTitle}>You are at the site</Text>
              </View>
              <Text style={styles.atSiteText}>
                Confirm when you have reached {siteName}. Live GPS keeps running until then.
              </Text>
              <PrimaryButton
                label="Confirm - Complete Journey"
                onPress={openArrivalPrompt}
                disabled={completing}
                loading={completing}
                style={styles.atSiteButton}
              />
            </View>
          ) : isTracking ? (
            <View style={styles.infoCard}>
              <Ionicons name="information-circle" size={18} color={colors.statBlueIcon} />
              <Text style={styles.infoCardText}>
                When you are within {ARRIVAL_RADIUS_M} m of the site you will be asked to confirm that you have
                reached it. Live GPS pings continue until you tap "Confirm".
              </Text>
            </View>
          ) : null}
          </>
          )}

          <View style={styles.bottomSpacer} />
        </View>
      </ScrollView>

      <DriverBottomTabBar activeTab={activeTab} onTabPress={handleTabPress} />

      {/* ── You have reached the site (<= 100 m) ── */}
      <Modal
        visible={arrivalPromptVisible && isTracking && !pendingPod}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleCancelArrival}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard} accessibilityViewIsModal>
            <View style={styles.modalIconCircle}>
              <Ionicons name="location" size={30} color={colors.statGreenIcon} />
            </View>

            <Text style={styles.modalTitle}>You have reached the site location</Text>
            <Text style={styles.modalSite}>{siteName}</Text>
            <Text style={styles.modalBody}>
              {distanceToSiteM !== null
                ? `You are ${formatDistance(distanceToSiteM)} from the site. `
                : ''}
              Tap "Confirm" to upload the proof of delivery. The journey is completed after the photo is
              uploaded; Live GPS keeps running until then.
            </Text>

            <View style={styles.modalTripRow}>
              <Text style={styles.modalTripText} numberOfLines={1}>
                {dispatch?.dispatchID}
                {vehicleNumber ? ` • ${vehicleNumber}` : ''}
              </Text>
            </View>

            {completeError ? (
              <View style={styles.modalError}>
                <Ionicons name="warning" size={16} color={colors.error} />
                <Text style={styles.modalErrorText}>{completeError}</Text>
              </View>
            ) : null}

            <View style={styles.modalButtons}>
              <Pressable
                onPress={handleCancelArrival}
                disabled={completing}
                accessibilityRole="button"
                accessibilityLabel="Not yet, keep tracking"
                style={({ pressed }) => [
                  styles.modalButton,
                  styles.modalCancel,
                  (pressed || completing) && styles.modalButtonDim,
                ]}
              >
                <Text style={styles.modalCancelText}>Not yet</Text>
              </Pressable>

              <Pressable
                onPress={handleConfirmArrival}
                disabled={completing}
                accessibilityRole="button"
                accessibilityLabel="Confirm, complete the journey"
                style={({ pressed }) => [styles.modalButton, styles.modalConfirm, pressed && styles.modalButtonDim]}
              >
                {completing ? (
                  <ActivityIndicator color={colors.white} />
                ) : (
                  <Text style={styles.modalConfirmText}>{completeError ? 'Try Again' : 'Confirm'}</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.white },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { paddingHorizontal: spacing.md },

  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.07,
    shadowRadius: 3,
    elevation: 2,
    gap: 4,
  },
  backLinkPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
    backgroundColor: '#F8FAFC',
  },
  backLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0B5FA8',
    letterSpacing: -0.1,
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  headerTitleBlock: { flex: 1 },
  title: { ...typography.h2, fontSize: 20, color: colors.textPrimary },
  titleSubtext: { ...typography.bodySmall, color: colors.textSecondary, marginTop: 2 },
  moduleBadge: {
    backgroundColor: colors.statBlueBg,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 3,
  },
  moduleBadgeArrived: {
    backgroundColor: colors.statGreenBg,
  },
  moduleBadgeText: {
    ...typography.caption,
    fontSize: 9,
    fontWeight: '700',
    color: colors.statBlueIcon,
    letterSpacing: 0.3,
  },
  moduleBadgeTextArrived: {
    color: colors.statGreenIcon,
  },

  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  errorBannerText: { ...typography.bodySmall, color: '#b91c1c', flex: 1 },

  routeHeaderCard: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.md,
    backgroundColor: colors.concreteLighter,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  routeLeg: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  routeLegText: { flex: 1 },
  routeDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.white },
  routeDotPlant: { backgroundColor: '#dc2626' },
  routeDotSite: { backgroundColor: '#16a34a' },
  routeLegLabel: { ...typography.caption, fontSize: 9, fontWeight: '700', color: colors.textSecondary },
  routeLegVal: { ...typography.label, fontSize: 13, color: colors.textPrimary, fontWeight: '700' },
  routeLegCoords: { fontSize: 11, color: colors.textSecondary, marginTop: 2 },
  routeDivider: {
    height: 1,
    backgroundColor: colors.cardBorder,
    marginVertical: 6,
  },

  mapCard: {
    borderWidth: 1.5,
    borderColor: colors.borderGray,
    borderRadius: radius.lg,
    overflow: 'hidden',
    height: 340,
    marginBottom: spacing.md,
    backgroundColor: '#e8f0e9',
    position: 'relative',
  },
  plainMapWrap: { flex: 1, position: 'relative' },
  plainMapHint: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  plainMapHintText: { color: '#fff', fontSize: 12, textAlign: 'center', fontWeight: '600' },
  mapLoadingBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15,23,42,0.85)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  mapLoadingBadgeText: { color: '#fff', fontSize: 12, fontWeight: '600', marginLeft: 8 },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.md,
  },
  loadingText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },

  gpsLockBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15,23,42,0.85)',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: radius.sm,
    zIndex: 10,
  },
  gpsLockDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#64748b',
  },
  gpsLockDotActive: { backgroundColor: '#10b981' },
  gpsLockText: { ...typography.caption, fontSize: 10, fontWeight: '700', color: colors.white },

  telemetryCard: {
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  telemetryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  telemetryLabel: { ...typography.bodySmall, color: colors.textSecondary },
  telemetryValue: { ...typography.bodySmall, color: colors.textPrimary, fontWeight: '700' },

  proceedButton: { marginBottom: spacing.md },

  atSiteCard: {
    backgroundColor: colors.statGreenBg,
    borderWidth: 1,
    borderColor: colors.statGreenIcon,
    borderRadius: radius.lg,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  atSiteHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  atSiteTitle: { ...typography.label, fontWeight: '800', color: colors.statGreenIcon },
  atSiteText: { ...typography.bodySmall, color: colors.textPrimary, marginTop: 4 },
  atSiteButton: { marginTop: spacing.sm, backgroundColor: colors.statGreenIcon },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  modalCard: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    padding: spacing.lg,
    alignItems: 'center',
  },
  modalIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.statGreenBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  modalTitle: { ...typography.h2, fontSize: 19, color: colors.textPrimary, textAlign: 'center' },
  modalSite: { ...typography.label, fontWeight: '800', color: colors.primary, marginTop: 4, textAlign: 'center' },
  modalBody: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 19,
  },
  modalTripRow: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.concreteLighter,
  },
  modalTripText: { ...typography.caption, fontWeight: '700', color: colors.darkGray },
  modalError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'stretch',
    marginTop: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.errorBackground,
  },
  modalErrorText: { ...typography.bodySmall, color: colors.error, flex: 1 },
  modalButtons: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'stretch', marginTop: spacing.lg },
  modalButton: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalCancel: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.borderGray },
  modalConfirm: { backgroundColor: colors.statGreenIcon },
  modalButtonDim: { opacity: 0.7 },
  modalCancelText: { ...typography.button, color: colors.darkGray },
  modalConfirmText: { ...typography.button, color: colors.white },

  socketOk: { color: '#15803d' },
  socketWarn: { color: '#b45309' },
  socketErrorText: { ...typography.caption, color: colors.error, marginTop: 4 },

  infoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.statBlueBg,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  infoCardText: { ...typography.bodySmall, color: colors.statBlueIcon, flex: 1 },
  noDispatchCard: {
    alignItems: 'center',
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  noDispatchTitle: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  emptyStateText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingHorizontal: spacing.md,
    marginTop: spacing.xs,
  },

  bottomSpacer: { height: spacing.lg },
});

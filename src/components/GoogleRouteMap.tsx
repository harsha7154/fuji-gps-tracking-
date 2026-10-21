import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../theme';
import { formatRouteDistance, formatRouteDuration, getRoadRouteProblem } from '../services/directionsService';
import { RoutePhase, useRouteTracker } from '../hooks/useRouteTracker';
import type { Pt } from '../utils/routeGeometry';
import { logMapLoad } from '../utils/apiUsageLogger';

// Same truck picture as the web Dispatch Tracker (top view, cab pointing north).
const TRUCK_IMAGE = require('../../assets/images/truck-top.png');

export interface GoogleRouteMapProps {
  /** Changes when another dispatch is shown. */
  dispatchKey?: string;
  /** [lat, lng] plant — the red start point. */
  plantCoord?: [number, number];
  /** [lat, lng] site — the green destination point. */
  destCoord: [number, number];
  /** [lat, lng] live device GPS ([0, 0] = no fix yet). Used only while in transit. */
  liveCoord: [number, number];
  liveHeading?: number;
  liveAccuracy?: number;
  /**
   * planned   = before the journey starts: plant -> site route
   * inTransit = journey running: truck (live GPS) -> site, travelled part gray
   * arrived   = completed: travelled route from the stored GPS history, gray
   */
  phase?: RoutePhase;
  /** Stored GPS history (oldest first) — the travelled route of a completed / resumed journey. */
  historyCoords?: [number, number][];
  plantLabel?: string;
  destLabel?: string;
  vehicleNumber?: string;
  /** Legacy: used when `phase` is not given. */
  isArrived?: boolean;
  /** Legacy raw GPS trail — no longer drawn (it made zig-zag lines). */
  trailCoords?: [number, number][];
}

// Same colours as the web Dispatch Tracker.
const COLOR_REMAINING = '#0284c7';
const COLOR_REMAINING_CASING = 'rgba(12,74,110,0.55)';
const COLOR_TRAVELLED = '#9ca3af';
const COLOR_TRAVELLED_CASING = 'rgba(55,65,81,0.45)';
const COLOR_FALLBACK = '#f59e0b'; // dashed amber = Google gave no road route
const COLOR_PLANT = '#dc2626';
const COLOR_SITE = '#16a34a';

const DEFAULT_REGION = { latitude: 21.1458, longitude: 79.0882, latitudeDelta: 5, longitudeDelta: 5 };
const FIT_PADDING = { top: 150, right: 50, bottom: 70, left: 50 };

const toLatLng = (p: Pt) => ({ latitude: p.lat, longitude: p.lng });

/** Top-view truck, turned to the driving direction by the Marker's `rotation`. */
const TruckMarkerContent: React.FC<{ live: boolean; onReady: () => void }> = ({ live, onReady }) => (
  <View style={styles.truckWrap}>
    <View style={[styles.truckHalo, live && styles.truckHaloLive]} />
    <Image source={TRUCK_IMAGE} style={styles.truckImage} resizeMode="contain" onLoad={onReady} fadeDuration={0} />
  </View>
);

const DotMarkerContent: React.FC<{ color: string }> = ({ color }) => (
  <View style={styles.dotOuter}>
    <View style={[styles.dotInner, { backgroundColor: color }]} />
  </View>
);

/**
 * Tracking map — native Google Maps (react-native-maps, PROVIDER_GOOGLE).
 * Draws the same picture as the web Dispatch Tracker:
 *
 *   red dot    plant (start)            green dot   site (destination)
 *   blue line  remaining road route     gray line   travelled road route
 *   truck      live GPS position, turned to the driving direction
 *
 * Which lines exist is decided by RouteTracker (see services/routeTracker.ts);
 * both lines always follow real roads, never straight GPS-to-GPS segments.
 */
export const GoogleRouteMap: React.FC<GoogleRouteMapProps> = ({
  dispatchKey,
  plantCoord,
  destCoord,
  liveCoord,
  liveHeading,
  liveAccuracy,
  phase: phaseProp,
  historyCoords,
  plantLabel = 'Plant',
  destLabel = 'Destination Site',
  vehicleNumber = '',
  isArrived = false,
}) => {
  const phase: RoutePhase = phaseProp ?? (isArrived ? 'arrived' : 'inTransit');

  const route = useRouteTracker({
    dispatchKey,
    plantCoord,
    destCoord,
    liveCoord,
    liveHeading,
    liveAccuracy,
    phase,
    historyCoords,
  });

  const inlineMapRef = useRef<MapView>(null);
  const fullscreenMapRef = useRef<MapView>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Custom marker views are snapshotted by the native map: keep tracking view
  // changes until the truck image has rendered, then stop (saves battery).
  const [truckTracksChanges, setTruckTracksChanges] = useState(true);
  const handleTruckReady = useCallback(() => {
    setTimeout(() => setTruckTracksChanges(false), 600);
  }, []);
  useEffect(() => {
    // The halo colour changes with `live` — snapshot again.
    setTruckTracksChanges(true);
    const timer = setTimeout(() => setTruckTracksChanges(false), 800);
    return () => clearTimeout(timer);
  }, [route.live]);

  // Follow the truck until the driver drags the map; "recenter" follows again.
  const followRef = useRef(true);
  const hasFittedRef = useRef(false);

  const grayLatLng = useMemo(() => route.gray.map((segment) => segment.map(toLatLng)), [route.gray]);
  const blueLatLng = useMemo(() => route.blue.map(toLatLng), [route.blue]);
  // Road piece the truck is driving over right now (changes every animation frame; it is short).
  const trailLatLng = useMemo(() => route.trail.map(toLatLng), [route.trail]);

  const fitAll = useCallback(
    (ref: React.RefObject<MapView | null>, animated: boolean) => {
      const points: Pt[] = [];
      if (phase === 'arrived') {
        route.gray.forEach((segment) => points.push(...segment));
      } else {
        if (route.truck) points.push(route.truck);
        points.push(...route.blue);
        if (phase === 'planned' && route.plant) points.push(route.plant);
      }
      if (route.dest) points.push(route.dest);
      if (points.length === 0 && route.plant) points.push(route.plant);
      if (points.length === 0) return;

      if (points.length === 1) {
        ref.current?.animateToRegion(
          { ...toLatLng(points[0]), latitudeDelta: 0.006, longitudeDelta: 0.006 },
          animated ? 400 : 0
        );
        return;
      }
      ref.current?.fitToCoordinates(points.map(toLatLng), { edgePadding: FIT_PADDING, animated });
    },
    [phase, route.gray, route.blue, route.truck, route.plant, route.dest]
  );

  // Another dispatch or journey phase: fit the map again.
  useEffect(() => {
    hasFittedRef.current = false;
  }, [phase, dispatchKey]);

  // First picture ready (or the journey phase / dispatch / site position changed): show the whole route.
  // The Live GPS screen now mounts this map BEFORE the dispatch is known and feeds the data in later,
  // so a new dispatch or a new site position must re-fit the camera (it used to get a fresh map instead).
  const fitDestLat = route.dest?.lat;
  const fitDestLng = route.dest?.lng;
  useEffect(() => {
    if (!route.ready) {
      hasFittedRef.current = false;
      return;
    }
    if (hasFittedRef.current) return;
    hasFittedRef.current = true;
    followRef.current = true;
    const timer = setTimeout(() => {
      fitAll(inlineMapRef, false);
      fitAll(fullscreenMapRef, false);
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.ready, phase, dispatchKey, fitDestLat, fitDestLng]);

  // Keep the live truck in view. The camera glides to where the truck is
  // driving to, in the same time the truck takes — one camera move per GPS
  // position, not one per animation frame.
  const targetLat = route.truckTarget?.lat;
  const targetLng = route.truckTarget?.lng;
  const moveMs = route.moveMs;
  useEffect(() => {
    if (!route.live || !followRef.current || targetLat === undefined || targetLng === undefined) return;
    const center = { latitude: targetLat, longitude: targetLng };
    const duration = moveMs > 0 ? moveMs : 600;
    inlineMapRef.current?.animateCamera({ center }, { duration });
    fullscreenMapRef.current?.animateCamera({ center }, { duration });
    // moveMs belongs to the same update as the target; it must not restart the camera on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.live, targetLat, targetLng]);

  const handleZoom = (ref: React.RefObject<MapView | null>, delta: number) => {
    ref.current?.getCamera().then((cam) => {
      ref.current?.animateCamera({ ...cam, zoom: (cam.zoom ?? 15) + delta }, { duration: 250 });
    });
  };

  const handleRecenter = (ref: React.RefObject<MapView | null>) => {
    followRef.current = true;
    fitAll(ref, true);
  };

  const hasLiveFix = liveCoord[0] !== 0 && liveCoord[1] !== 0;

  // Status badge (top-left), like the web tracker.
  const badge = (() => {
    if (!route.ready) return { text: 'LOADING ROUTE…', color: '#94a3b8' };
    if (phase === 'arrived') return { text: 'JOURNEY COMPLETED', color: '#16a34a' };
    if (phase === 'planned') return { text: 'JOURNEY NOT STARTED', color: '#64748b' };
    if (route.live && hasLiveFix) {
      return {
        text: liveAccuracy ? `LIVE • ±${Math.round(liveAccuracy)} m` : 'LIVE',
        color: '#10b981',
      };
    }
    if (route.truck) return { text: 'LAST SAVED POSITION', color: '#10b981' };
    return { text: 'SEARCHING GPS…', color: '#f59e0b' };
  })();

  const remainingLabel =
    phase !== 'arrived' && route.remainingM !== null && route.remainingM > 0 && !route.fallback
      ? `${formatRouteDistance(route.remainingM)}${
          route.remainingMs ? ` • ${formatRouteDuration(route.remainingMs)}` : ''
        }`
      : '';

  const showTruck = phase !== 'planned' && !!route.truck;

  const renderMapSurface = (ref: React.RefObject<MapView | null>, fullscreen: boolean) => (
    <View style={fullscreen ? styles.fullscreenMapWrap : styles.inlineMapWrap}>
      <MapView
        ref={ref}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={
          route.dest
            ? { ...toLatLng(route.dest), latitudeDelta: 0.02, longitudeDelta: 0.02 }
            : DEFAULT_REGION
        }
        onMapReady={() => {
          logMapLoad(fullscreen ? 'GoogleRouteMap fullscreen' : `GoogleRouteMap inline phase=${phase}`);
          if (route.ready) fitAll(ref, false);
        }}
        onPanDrag={() => {
          followRef.current = false;
        }}
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        zoomControlEnabled={false}
        zoomEnabled
        rotateEnabled
        pitchEnabled={false}
      >
        {/* Remaining route: blue (dashed amber when Google gave no road route) */}
        {blueLatLng.length > 1 && !route.fallback ? (
          <Polyline coordinates={blueLatLng} strokeColor={COLOR_REMAINING_CASING} strokeWidth={8} zIndex={2} />
        ) : null}
        {blueLatLng.length > 1 ? (
          <Polyline
            coordinates={blueLatLng}
            strokeColor={route.fallback ? COLOR_FALLBACK : COLOR_REMAINING}
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
            lineDashPattern={route.fallback ? [14, 10] : undefined}
            zIndex={3}
          />
        ) : null}

        {/* Travelled route: gray, one polyline per road piece */}
        {grayLatLng.map((segment, i) => (
          <Polyline
            key={`gray-casing-${i}-${segment.length}`}
            coordinates={segment}
            strokeColor={COLOR_TRAVELLED_CASING}
            strokeWidth={8}
            zIndex={4}
          />
        ))}
        {grayLatLng.map((segment, i) => (
          <Polyline
            key={`gray-${i}-${segment.length}`}
            coordinates={segment}
            strokeColor={COLOR_TRAVELLED}
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
            zIndex={5}
          />
        ))}

        {/* The road the truck is driving over right now: gray, on top of the blue line */}
        {trailLatLng.length > 1 ? (
          <Polyline coordinates={trailLatLng} strokeColor={COLOR_TRAVELLED_CASING} strokeWidth={8} zIndex={4} />
        ) : null}
        {trailLatLng.length > 1 ? (
          <Polyline
            coordinates={trailLatLng}
            strokeColor={COLOR_TRAVELLED}
            strokeWidth={5}
            lineCap="round"
            lineJoin="round"
            zIndex={5}
          />
        ) : null}

        {route.plant ? (
          <Marker
            coordinate={toLatLng(route.plant)}
            anchor={{ x: 0.5, y: 0.5 }}
            title="Plant (start)"
            description={plantLabel}
            tracksViewChanges={false}
            zIndex={6}
          >
            <DotMarkerContent color={COLOR_PLANT} />
          </Marker>
        ) : null}

        {route.dest ? (
          <Marker
            coordinate={toLatLng(route.dest)}
            anchor={{ x: 0.5, y: 0.5 }}
            title="Site (destination)"
            description={destLabel}
            tracksViewChanges={false}
            zIndex={7}
          >
            <DotMarkerContent color={COLOR_SITE} />
          </Marker>
        ) : null}

        {showTruck && route.truck ? (
          <Marker
            coordinate={toLatLng(route.truck)}
            anchor={{ x: 0.5, y: 0.5 }}
            flat
            rotation={route.heading}
            title={vehicleNumber ? `Truck • ${vehicleNumber}` : 'Truck'}
            tracksViewChanges={truckTracksChanges}
            zIndex={10}
          >
            <TruckMarkerContent live={route.live && phase === 'inTransit'} onReady={handleTruckReady} />
          </Marker>
        ) : null}
      </MapView>

      {/* Badge + legend */}
      <SafeAreaView
        edges={fullscreen ? ['top'] : []}
        style={[styles.topLeftStack, fullscreen && styles.topLeftStackFullscreen]}
        pointerEvents="none"
      >
        <View style={styles.badge}>
          <View style={[styles.badgeDot, { backgroundColor: badge.color }]} />
          <Text style={styles.badgeText}>{badge.text}</Text>
        </View>

        <View style={styles.legend}>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: COLOR_PLANT }]} />
            <Text style={styles.legendText}>Plant (start)</Text>
          </View>
          <View style={styles.legendRow}>
            <View style={[styles.legendDot, { backgroundColor: COLOR_SITE }]} />
            <Text style={styles.legendText}>Site (destination)</Text>
          </View>
          {phase !== 'planned' ? (
            <>
              <View style={styles.legendRow}>
                <View style={[styles.legendSwatch, { backgroundColor: COLOR_TRAVELLED }]} />
                <Text style={styles.legendText}>Travelled</Text>
              </View>
              <View style={styles.legendRow}>
                <View style={[styles.legendSwatch, { backgroundColor: COLOR_REMAINING }]} />
                <Text style={styles.legendText}>Remaining</Text>
              </View>
            </>
          ) : null}
          {route.fallback ? (
            <View style={styles.legendRow}>
              <View style={[styles.legendSwatch, { backgroundColor: COLOR_FALLBACK }]} />
              <Text style={styles.legendText}>Road route unavailable</Text>
            </View>
          ) : null}
          {route.fallback && getRoadRouteProblem() ? (
            <Text style={styles.legendNote}>{getRoadRouteProblem()}</Text>
          ) : null}
        </View>
      </SafeAreaView>

      {fullscreen ? (
        <SafeAreaView edges={['top']} style={styles.closeButtonWrap} pointerEvents="box-none">
          <Pressable
            onPress={() => setIsFullscreen(false)}
            style={styles.roundButton}
            hitSlop={8}
            accessibilityLabel="Exit full screen map"
          >
            <Ionicons name="close" size={20} color={colors.textPrimary} />
          </Pressable>
        </SafeAreaView>
      ) : (
        <Pressable
          onPress={() => setIsFullscreen(true)}
          style={[styles.roundButton, styles.fullscreenToggleButton]}
          hitSlop={8}
          accessibilityLabel="Open full screen map"
        >
          <Ionicons name="expand" size={16} color={colors.textPrimary} />
        </Pressable>
      )}

      {remainingLabel ? (
        <View style={[styles.remainingChip, fullscreen && styles.bottomFullscreen]} pointerEvents="none">
          <Ionicons name="navigate" size={12} color={colors.white} />
          <Text style={styles.remainingText}>{remainingLabel}</Text>
        </View>
      ) : null}

      <View style={[styles.zoomStack, fullscreen && styles.bottomFullscreen]}>
        <Pressable onPress={() => handleZoom(ref, 1)} style={styles.zoomButton} hitSlop={6} accessibilityLabel="Zoom in">
          <Ionicons name="add" size={20} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.zoomDivider} />
        <Pressable onPress={() => handleZoom(ref, -1)} style={styles.zoomButton} hitSlop={6} accessibilityLabel="Zoom out">
          <Ionicons name="remove" size={20} color={colors.textPrimary} />
        </Pressable>
      </View>

      <Pressable
        onPress={() => handleRecenter(ref)}
        style={[styles.recenterButton, fullscreen && styles.bottomFullscreen]}
        hitSlop={6}
        accessibilityLabel="Show the whole route"
      >
        <Ionicons name="navigate" size={18} color={colors.primary} />
      </Pressable>
    </View>
  );

  return (
    <>
      {renderMapSurface(inlineMapRef, false)}

      {isFullscreen ? (
        <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => setIsFullscreen(false)}>
          {renderMapSurface(fullscreenMapRef, true)}
        </Modal>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  inlineMapWrap: { flex: 1, position: 'relative' },
  fullscreenMapWrap: { flex: 1, position: 'relative', backgroundColor: colors.white },
  map: { flex: 1 },

  // Truck (26 x 52 on the web tracker)
  truckWrap: { width: 60, height: 60, alignItems: 'center', justifyContent: 'center' },
  truckHalo: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(100,116,139,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(100,116,139,0.3)',
  },
  truckHaloLive: {
    backgroundColor: 'rgba(2,132,199,0.16)',
    borderColor: 'rgba(2,132,199,0.4)',
  },
  truckImage: { width: 28, height: 56 },

  // Plant / site dots
  dotOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  dotInner: { width: 14, height: 14, borderRadius: 7 },

  // Badge + legend
  topLeftStack: { position: 'absolute', top: 10, left: 10, zIndex: 10, alignItems: 'flex-start' },
  topLeftStackFullscreen: { top: 10 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(15,23,42,0.88)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: { color: colors.white, fontSize: 10, fontWeight: '800', letterSpacing: 0.3 },
  legend: {
    marginTop: 6,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    gap: 3,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 9, height: 9, borderRadius: 5, borderWidth: 1.5, borderColor: colors.white },
  legendSwatch: { width: 14, height: 4, borderRadius: 2 },
  legendText: { fontSize: 10, fontWeight: '700', color: colors.textPrimary },
  legendNote: { fontSize: 9, color: '#b45309', marginTop: 2, maxWidth: 150 },

  roundButton: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
  },
  fullscreenToggleButton: { position: 'absolute', top: 10, right: 10, zIndex: 10 },
  closeButtonWrap: { position: 'absolute', top: 10, right: 10, zIndex: 10 },

  remainingChip: {
    position: 'absolute',
    bottom: 16,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(2,132,199,0.95)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    zIndex: 10,
  },
  remainingText: { color: colors.white, fontSize: 11, fontWeight: '800' },

  zoomStack: {
    position: 'absolute',
    bottom: 14,
    right: 10,
    borderRadius: 10,
    backgroundColor: colors.white,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
    overflow: 'hidden',
    zIndex: 10,
  },
  zoomButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  zoomDivider: { height: 1, backgroundColor: colors.cardBorder, marginHorizontal: 6 },

  recenterButton: {
    position: 'absolute',
    bottom: 14,
    left: 10,
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 4,
    zIndex: 10,
  },
  bottomFullscreen: { bottom: 28 },
});

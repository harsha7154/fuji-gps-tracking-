/**
 * React wrapper around RouteTracker, shared by the native Google map
 * (GoogleRouteMap.tsx) and the web-preview map (GoogleRouteMap.web.tsx).
 *
 * Give it the plant, the site, the stored GPS history, the journey phase and
 * the live GPS position; it returns the lines and the truck to draw.
 */
import { useEffect, useRef, useState } from 'react';

import { fetchRoadRoute } from '../services/directionsService';
import { logLivePosition } from '../utils/apiUsageLogger';
import { RouteTracker } from '../services/routeTracker';
import { Pt, tupleToPt } from '../utils/routeGeometry';
import { DisplayState, TruckAnimator } from '../utils/truckAnimation';

/** planned = not started · inTransit = journey running · arrived = completed */
export type RoutePhase = 'planned' | 'inTransit' | 'arrived';

export interface UseRouteTrackerInput {
  /** Changes when another dispatch is shown (rebuilds everything). */
  dispatchKey?: string;
  plantCoord?: [number, number];
  destCoord?: [number, number];
  /** Live device GPS; [0, 0] = no fix yet. */
  liveCoord?: [number, number];
  liveHeading?: number;
  liveAccuracy?: number;
  phase: RoutePhase;
  /** Stored GPS history, oldest first. */
  historyCoords?: [number, number][];
}

const NOT_READY: DisplayState = {
  ready: false,
  gray: [],
  blue: [],
  truck: null,
  heading: 0,
  live: false,
  remainingM: null,
  remainingMs: null,
  fallback: false,
  trail: [],
  truckTarget: null,
  moveMs: 0,
};

export function useRouteTracker(input: UseRouteTrackerInput): DisplayState & { plant: Pt | null; dest: Pt | null } {
  const { dispatchKey, plantCoord, destCoord, liveCoord, liveHeading, liveAccuracy, phase, historyCoords } = input;

  const [state, setState] = useState<DisplayState>(NOT_READY);
  const trackerRef = useRef<RouteTracker | null>(null);

  const plantLat = plantCoord?.[0] ?? 0;
  const plantLng = plantCoord?.[1] ?? 0;
  const destLat = destCoord?.[0] ?? 0;
  const destLng = destCoord?.[1] ?? 0;
  const started = phase !== 'planned';

  // Read at init time only (a new array on every render must not rebuild the route).
  const historyRef = useRef(historyCoords);
  historyRef.current = historyCoords;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  // Latest live position, re-applied when the route is rebuilt so the truck does not disappear.
  const liveRef = useRef({ liveCoord, liveHeading, liveAccuracy });
  liveRef.current = { liveCoord, liveHeading, liveAccuracy };

  // Build the picture. Runs again only for another dispatch, other end points,
  // or when the journey starts.
  useEffect(() => {
    // PLAIN MAP until the driver taps "Activate Journey": no route is drawn
    // and NO Google Routes API request is made. Only the plant / site markers
    // (and an empty map when there is no dispatch) are shown. The route is
    // requested the moment the phase becomes 'inTransit' (this effect re-runs
    // because `started` flips to true).
    if (!started) {
      console.log('[API-USAGE] PLAIN-MAP journey not started -> no Routes API request');
      setState({ ...NOT_READY, ready: true });
      return;
    }

    // The tracker decides the lines; the animator drives the truck smoothly
    // along the road from one position to the next (no jumping).
    const animator = new TruckAnimator(setState);
    const tracker = new RouteTracker(fetchRoadRoute, (next) => animator.push(next));
    trackerRef.current = tracker;
    setState(NOT_READY);

    const pings = (historyRef.current ?? [])
      .map((c) => tupleToPt(c))
      .filter((p): p is Pt => p !== null);

    // Re-apply the last live position (queued until init finishes): after a rebuild the truck
    // stays where it was instead of vanishing until the next WebSocket update.
    const last = liveRef.current;
    if (phaseRef.current === 'inTransit' && last.liveCoord && (last.liveCoord[0] !== 0 || last.liveCoord[1] !== 0)) {
      tracker.onPosition({
        lat: last.liveCoord[0],
        lng: last.liveCoord[1],
        heading: last.liveHeading,
        accuracy: last.liveAccuracy,
        ts: Date.now(),
      });
    }

    tracker
      .init({
        plant: tupleToPt([plantLat, plantLng]),
        dest: tupleToPt([destLat, destLng]),
        pings,
        started,
        arrived: phaseRef.current === 'arrived',
      })
      .catch((err) => console.warn('[useRouteTracker] could not build the route:', err));

    return () => {
      tracker.dispose();
      animator.dispose();
      if (trackerRef.current === tracker) trackerRef.current = null;
    };
  }, [dispatchKey, plantLat, plantLng, destLat, destLng, started]);

  // Journey completed while the map is open.
  useEffect(() => {
    if (phase === 'arrived') trackerRef.current?.confirmArrived();
  }, [phase]);

  // Live GPS.
  const liveLat = liveCoord?.[0] ?? 0;
  const liveLng = liveCoord?.[1] ?? 0;
  useEffect(() => {
    if (phase !== 'inTransit') return;
    if (liveLat === 0 && liveLng === 0) return;
    logLivePosition(liveLat, liveLng);
    trackerRef.current?.onPosition({
      lat: liveLat,
      lng: liveLng,
      heading: liveHeading,
      accuracy: liveAccuracy,
      ts: Date.now(),
    });
    // heading / accuracy ride along with a new coordinate; they must not re-send the same point.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, liveLat, liveLng, dispatchKey, started]);

  return {
    ...state,
    plant: tupleToPt([plantLat, plantLng]),
    dest: tupleToPt([destLat, destLng]),
  };
}

/**
 * RouteTracker — decides what the tracking map draws.
 *
 * Mobile port of the web Dispatch Tracker logic (dispatch-tracker.jsp), so the
 * app and the web page show the same picture:
 *
 *   BEFORE the journey starts   plant -> site road route (blue), no truck
 *   AFTER the start             truck (live GPS) -> site (blue);
 *                               the part behind the truck turns gray
 *   COMPLETED                   only the travelled route (gray), from the
 *                               stored GPS history, truck at the last position
 *
 * ROADS
 *   Both lines always follow the road route from Google. Raw GPS points are
 *   never joined with straight lines (no zig-zag "snake" line):
 *     - while the truck is on the route, the part of the ROUTE behind it
 *       becomes the travelled line;
 *     - when it leaves the route, a new route is requested (at most once every
 *       20 s) and the stretch it drove meanwhile is road-routed too;
 *     - history is routed through the stored pings (thinned to >= 150 m apart).
 *
 * No React / maps imports here: `computeRoad` is injected, so this file can be
 * unit-tested and is shared by the native map and the web-preview map.
 */

import {
  bearing,
  dedupePath,
  isValidPt,
  meters,
  pathLength,
  projectOnPath,
  Pt,
  thinPings,
} from '../utils/routeGeometry';

export interface RoadRouteLike {
  path: Pt[];
  distanceM: number;
  durationMs: number;
}

/** `reason` is only used for the [API-USAGE] log: why this route is being requested. */
export type ComputeRoad = (origin: Pt, destination: Pt, via: Pt[], reason?: string) => Promise<RoadRouteLike | null>;

export interface TrackerPosition extends Pt {
  /** GPS accuracy, meters. */
  accuracy?: number;
  /** Compass heading from the GPS, degrees. */
  heading?: number;
  /** Epoch millis. */
  ts?: number;
}

export interface TrackerState {
  /** false until the first picture has been built. */
  ready: boolean;
  /**
   * Travelled route (gray), as one or more road-following pieces. Pieces are
   * drawn separately so a stretch that is still being road-routed is simply
   * not drawn yet — never bridged with a straight line.
   */
  gray: Pt[][];
  /** Remaining route (blue). */
  blue: Pt[];
  /** Where the truck icon is; null = no truck yet. */
  truck: Pt | null;
  /** Truck direction, degrees. */
  heading: number;
  /** true while the truck position comes from live GPS. */
  live: boolean;
  /** Remaining distance / time of the blue route. */
  remainingM: number | null;
  remainingMs: number | null;
  /** true when Google could not give a road route and a direct line is shown. */
  fallback: boolean;
}

export interface TrackerInit {
  plant: Pt | null;
  dest: Pt | null;
  /** Stored GPS history, oldest first. */
  pings: TrackerPosition[];
  /** Journey started (In Transit or Arrived). */
  started: boolean;
  /** Journey completed. */
  arrived: boolean;
}

const SNAP_METERS = 60; // a position this close to the route is "on the route"
const HISTORY_SNAP_METERS = 80;
const REROUTE_MIN_MS = 20000;
const REROUTE_MAX_MS = 5 * 60000; // while Google keeps failing
// Off the route for this many positions in a row, or this far from it: new route truck -> site.
const REROUTE_AFTER_POSITIONS = 2;
const REROUTE_AT_METERS = 100;
const MAX_ACCURACY_METERS = 100; // worse positions are ignored
const MIN_MOVE_METERS = 8;

const EMPTY: TrackerState = {
  ready: false,
  gray: [],
  blue: [],
  truck: null,
  heading: 0,
  live: false,
  remainingM: null,
  remainingMs: null,
  fallback: false,
};

export class RouteTracker {
  private gray: Pt[][] = [];
  private blue: Pt[] = [];
  private pos: Pt | null = null;
  private heading = 0;
  private live = false;
  private routeInfo: { distanceM: number; durationMs: number } | null = null;
  private fallback = false;

  private ready = false;
  private disposed = false;
  private arrived = false;
  private dest: Pt | null = null;
  private queued: TrackerPosition | null = null;

  private offRoute = 0;
  private lastRerouteAt = 0;
  /** Wait between two route requests; doubles while Google keeps failing (saves quota). */
  private rerouteWaitMs = REROUTE_MIN_MS;
  private rerouting = false;
  private lastTs = 0;
  /** Set while the truck is off the route: where the gray line stopped. */
  private grayGapFrom: Pt | null = null;

  constructor(
    private readonly computeRoad: ComputeRoad,
    private readonly onChange: (state: TrackerState) => void,
    private readonly now: () => number = () => Date.now()
  ) {}

  dispose(): void {
    this.disposed = true;
  }

  getState(): TrackerState {
    if (!this.ready) return EMPTY;
    const remainingM = this.blue.length > 1 ? pathLength(this.blue) : this.arrived ? 0 : null;
    // Scale the route's time by how much of it is left.
    const remainingMs =
      this.routeInfo && this.routeInfo.distanceM > 0 && remainingM !== null && this.routeInfo.durationMs > 0
        ? Math.round((this.routeInfo.durationMs * Math.min(remainingM, this.routeInfo.distanceM)) / this.routeInfo.distanceM)
        : null;
    return {
      ready: true,
      gray: this.gray.filter((segment) => segment.length > 1),
      blue: this.blue,
      // The truck is drawn only from live GPS (ws/gps/live); the stored history from
      // Liferay draws the travelled line but never places the truck. After arrival the
      // final picture shows it at the site.
      truck: this.live || this.arrived ? this.pos : null,
      heading: this.heading,
      live: this.live,
      remainingM,
      remainingMs,
      fallback: this.fallback,
    };
  }

  private grayEnd(): Pt | null {
    const lastSegment = this.gray[this.gray.length - 1];
    return lastSegment && lastSegment.length ? lastSegment[lastSegment.length - 1] : null;
  }

  /** Adds points to the end of the current travelled piece. */
  private appendGray(points: Pt[]): void {
    if (!points.length) return;
    if (!this.gray.length) this.gray.push([]);
    const i = this.gray.length - 1;
    this.gray[i] = dedupePath(this.gray[i].concat(points));
    this.gray = this.gray.slice(); // new array reference for React
  }

  /** Adds a separate travelled piece (a road-routed stretch). */
  private addGraySegment(points: Pt[]): void {
    const segment = dedupePath(points);
    if (segment.length > 1) this.gray = this.gray.concat([segment]);
  }

  private emit(): void {
    if (!this.disposed) this.onChange(this.getState());
  }

  private async road(origin: Pt, destination: Pt, via: Pt[] = [], reason = 'unspecified'): Promise<RoadRouteLike | null> {
    try {
      const route = await this.computeRoad(origin, destination, via, reason);
      if (route && route.path.length > 1) {
        return { ...route, distanceM: route.distanceM || pathLength(route.path) };
      }
    } catch (err) {
      console.warn('[RouteTracker] road route failed:', err);
    }
    return null;
  }

  private async roadThrough(points: Pt[]): Promise<Pt[]> {
    if (points.length < 2) return points.slice();
    let path: Pt[] = [];
    for (let i = 0; i < points.length - 1; i += 24) {
      const chunk = points.slice(i, i + 25);
      if (chunk.length < 2) break;
      const route = await this.road(chunk[0], chunk[chunk.length - 1], chunk.slice(1, -1), 'init-history-through-pings');
      path = path.concat(route ? route.path : chunk);
    }
    return path;
  }

  /** Builds the first picture from the plant, the site and the stored pings. */
  async init(input: TrackerInit): Promise<void> {
    const pings = input.pings.filter(isValidPt);
    const plant = isValidPt(input.plant) ? input.plant : null;
    this.dest = isValidPt(input.dest) ? input.dest : null;
    this.arrived = input.arrived;
    const dest = this.dest;

    const origin = plant ?? pings[0] ?? null;
    const last = pings.length ? pings[pings.length - 1] : null;

    try {
      const base = origin && dest ? await this.road(origin, dest, [], input.started ? 'init-planned-route' : 'init-plant-to-site') : null;
      if (this.disposed) return;

      // ── Not started: plant -> site, no truck ──────────────────────────────
      if (!input.started) {
        if (base) {
          this.blue = base.path;
          this.routeInfo = { distanceM: base.distanceM, durationMs: base.durationMs };
        } else if (origin && dest) {
          this.blue = [origin, dest];
          this.fallback = true;
        }
        return;
      }

      let lastProjection = null as ReturnType<typeof projectOnPath>;
      let onRouteCount = 0;
      if (base) {
        this.routeInfo = { distanceM: base.distanceM, durationMs: base.durationMs };
        for (const p of pings) {
          lastProjection = projectOnPath(base.path, p);
          if (lastProjection && lastProjection.dist <= HISTORY_SNAP_METERS) onRouteCount++;
        }
      }

      // ── The driver followed the planned route ─────────────────────────────
      const followedRoute =
        !!base &&
        (!pings.length ||
          (onRouteCount / pings.length >= 0.85 &&
            (this.arrived || (!!lastProjection && lastProjection.dist <= HISTORY_SNAP_METERS))));

      if (base && followedRoute) {
        if (this.arrived) {
          this.gray = [base.path.slice()];
          this.pos = base.path[base.path.length - 1];
          this.blue = [];
        } else if (!last || !lastProjection) {
          // Started, no GPS stored yet: whole route still ahead.
          this.blue = base.path;
        } else {
          this.gray = [base.path.slice(0, lastProjection.index + 1).concat([lastProjection.point])];
          this.pos = lastProjection.point;
          this.blue = [this.pos].concat(base.path.slice(lastProjection.index + 1));
        }
        return;
      }

      if (!pings.length) {
        // No road route and no history: nothing sensible to draw but a direct line.
        if (!base && origin && dest && !this.arrived) {
          this.blue = [origin, dest];
          this.fallback = true;
        }
        return;
      }

      // ── The driver took other roads: road route through the stored pings ──
      let points: Pt[] = thinPings(pings);
      if (plant && meters(plant, points[0]) > 30) points = [plant as Pt].concat(points);
      if (this.arrived && dest && meters(points[points.length - 1], dest) > 30) points = points.concat([dest]);

      const path = await this.roadThrough(points);
      if (this.disposed) return;
      this.gray = [path.slice()];
      this.pos = path[path.length - 1] ?? null;
      this.blue = [];

      if (!this.arrived && dest && this.pos) {
        const route = await this.road(this.pos, dest, [], 'init-remaining-from-history');
        if (this.disposed) return;
        if (route) {
          this.blue = [this.pos].concat(route.path.slice(1));
          this.routeInfo = { distanceM: route.distanceM, durationMs: route.durationMs };
        } else {
          // Google gave no road route: a dashed direct line, marked "road route unavailable".
          this.blue = [this.pos, dest];
          this.fallback = true;
        }
      }
    } finally {
      if (!this.disposed) this.finishInit(last);
    }
  }

  private finishInit(last: TrackerPosition | null): void {
    this.ready = true;
    this.gray = this.gray.map(dedupePath);
    this.blue = dedupePath(this.blue);
    if (last?.ts) this.lastTs = last.ts;

    // Arrival was confirmed while the route was still being built.
    if (this.arrived && this.blue.length) {
      if (this.blue.length > 1 && !this.fallback && pathLength(this.blue) <= 400) {
        this.appendGray(this.blue);
        this.pos = this.blue[this.blue.length - 1];
      }
      this.blue = [];
      this.fallback = false;
    }

    if (this.pos) {
      const g = this.gray[this.gray.length - 1] ?? [];
      if (g.length > 1 && meters(g[g.length - 2], g[g.length - 1]) > 1) {
        this.heading = bearing(g[g.length - 2], g[g.length - 1]);
      } else if (this.blue.length > 1) {
        this.heading = bearing(this.pos, this.blue[1]);
      }
    }
    this.emit();

    if (this.queued) {
      const p = this.queued;
      this.queued = null;
      this.onPosition(p);
    }
  }

  /** A new live GPS position of the truck. */
  onPosition(p: TrackerPosition): void {
    if (this.disposed || this.arrived || !isValidPt(p)) return;
    if (!this.ready) {
      if (!this.queued || (p.ts ?? 0) >= (this.queued.ts ?? 0)) this.queued = p;
      return;
    }
    if (p.ts && p.ts < this.lastTs) return;
    if (p.ts) this.lastTs = p.ts;
    if ((p.accuracy ?? 0) > MAX_ACCURACY_METERS) return;

    const raw: Pt = { lat: p.lat, lng: p.lng };
    this.live = true;

    // First position of the truck.
    if (!this.pos) {
      this.placeFirst(p, raw);
      return;
    }

    const snap = SNAP_METERS + Math.min(p.accuracy ?? 0, 40);
    let projection = this.blue.length > 1 ? projectOnPath(this.blue, raw, 2500) : null;
    if (projection && projection.dist > snap) {
      const whole = projectOnPath(this.blue, raw);
      if (whole && whole.dist <= snap) projection = whole;
    }

    if (projection && projection.dist <= snap && !this.fallback) {
      // On the route: the part of the route behind the truck becomes travelled.
      this.offRoute = 0;
      if (projection.along >= 3 || this.grayGapFrom) {
        if (this.grayGapFrom) {
          // Back on the route after a detour: the detour is road-routed in the
          // background and a new travelled piece starts here.
          this.fillGap(this.grayGapFrom, projection.point);
          this.grayGapFrom = null;
          this.gray = this.gray.concat([[projection.point]]);
        } else {
          const passed = this.blue.slice(1, projection.index + 1);
          this.appendGray((this.grayEnd() ? [] : [this.blue[0]]).concat(passed, [projection.point]));
        }
        this.blue = [projection.point].concat(this.blue.slice(projection.index + 1));
        const ahead = this.blue.length > 1 ? this.blue[1] : null;
        this.heading =
          ahead && meters(projection.point, ahead) > 1
            ? bearing(projection.point, ahead)
            : Number.isFinite(p.heading) && (p.heading as number) >= 0
              ? (p.heading as number)
              : this.heading;
        this.pos = projection.point;
      }
      this.emit();
      return;
    }

    if (meters(this.pos, raw) < MIN_MOVE_METERS) {
      this.emit();
      return;
    }

    // Off the route: move the truck, but do NOT join GPS points with straight
    // lines. The stretch driven off-route is road-routed at the next reroute.
    this.offRoute++;
    if (!this.grayGapFrom) this.grayGapFrom = this.grayEnd() ?? this.pos;
    this.heading =
      Number.isFinite(p.heading) && (p.heading as number) >= 0 ? (p.heading as number) : bearing(this.pos, raw);
    this.pos = raw;
    if (this.blue.length) this.blue = [raw].concat(this.blue.slice(1));
    this.emit();

    if (
      !projection ||
      this.offRoute >= REROUTE_AFTER_POSITIONS ||
      projection.dist > REROUTE_AT_METERS ||
      this.fallback
    ) {
      this.reroute();
    }
  }

  private placeFirst(p: TrackerPosition, raw: Pt): void {
    const projection = this.blue.length > 1 && !this.fallback ? projectOnPath(this.blue, raw) : null;
    if (projection && projection.dist <= SNAP_METERS + Math.min(p.accuracy ?? 0, 40)) {
      this.gray = [dedupePath(this.blue.slice(0, projection.index + 1).concat([projection.point]))];
      this.pos = projection.point;
      this.blue = [this.pos].concat(this.blue.slice(projection.index + 1));
      this.heading = this.blue.length > 1 ? bearing(this.pos, this.blue[1]) : (p.heading ?? 0);
      this.emit();
      return;
    }

    // The driver started away from the planned route.
    this.pos = raw;
    this.gray = [[raw]];
    this.grayGapFrom = null;
    this.blue = this.dest ? [raw, this.dest] : [];
    this.fallback = this.blue.length > 0;
    this.heading = Number.isFinite(p.heading) && (p.heading as number) >= 0 ? (p.heading as number) : 0;
    this.emit();
    this.reroute();
  }

  /** Road-routes a stretch the truck drove off the planned route (drawn when it arrives). */
  private fillGap(from: Pt, to: Pt): void {
    if (meters(from, to) <= 30) {
      this.addGraySegment([from, to]);
      return;
    }
    this.road(from, to, [], 'gap-fill-after-detour').then((route) => {
      if (this.disposed || !route) return;
      this.addGraySegment(route.path);
      this.emit();
    });
  }

  /** New road route truck -> site, plus the road the truck drove while off-route. */
  private reroute(): void {
    const now = this.now();
    if (this.rerouting || this.arrived || !this.dest || !this.pos) return;
    if (this.lastRerouteAt && now - this.lastRerouteAt < this.rerouteWaitMs) return;

    const from = this.pos;
    const dest = this.dest;
    const gapFrom = this.grayGapFrom;
    console.log(
      `[API-USAGE] ${new Date().toLocaleTimeString()} REROUTE-TRIGGER truck left the route ` +
        `(offRoute=${this.offRoute} waitMs=${this.rerouteWaitMs}) -> will request a new route`
    );
    this.rerouting = true;
    this.lastRerouteAt = now;

    Promise.all([
      this.road(from, dest, [], 'reroute-remaining'),
      gapFrom && meters(gapFrom, from) > 30 ? this.road(gapFrom, from, [], 'reroute-driven-stretch') : Promise.resolve(null),
    ])
      .then(([route, driven]) => {
        this.rerouting = false;
        if (this.disposed || this.arrived) return;

        if (driven) {
          this.addGraySegment(driven.path);
          // Only move the gap start if the truck is still off the route.
          if (this.grayGapFrom) this.grayGapFrom = driven.path[driven.path.length - 1];
        }

        if (route) {
          const current = this.pos ?? from;
          const projection = projectOnPath(route.path, current);
          this.blue =
            projection && projection.dist <= SNAP_METERS * 2
              ? [current].concat(route.path.slice(projection.index + 1))
              : [current].concat(route.path);
          this.routeInfo = { distanceM: route.distanceM, durationMs: route.durationMs };
          this.fallback = false;
          this.offRoute = 0;
          this.rerouteWaitMs = REROUTE_MIN_MS;
        } else {
          this.rerouteWaitMs = Math.min(this.rerouteWaitMs * 2, REROUTE_MAX_MS);
        }
        this.emit();
      })
      .catch(() => {
        this.rerouting = false;
      });
  }

  /**
   * The driver confirmed the arrival: no remaining route any more. A short rest
   * of the route (the truck is at the site) becomes travelled.
   */
  confirmArrived(): void {
    if (this.arrived) return;
    this.arrived = true;
    if (!this.ready) return; // init() finishes with the arrived picture

    if (this.blue.length > 1 && !this.fallback && pathLength(this.blue) <= 400) {
      const end = this.grayEnd();
      if (end && meters(end, this.blue[0]) <= 30 && !this.grayGapFrom) this.appendGray(this.blue);
      else this.addGraySegment(this.blue);
      this.pos = this.blue[this.blue.length - 1];
    }
    if (this.grayGapFrom && this.pos) this.fillGap(this.grayGapFrom, this.blue.length > 1 ? this.blue[0] : this.pos);
    this.grayGapFrom = null;
    this.blue = [];
    this.live = false;
    this.fallback = false;
    this.emit();
  }
}

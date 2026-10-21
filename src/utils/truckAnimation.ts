/**
 * Smooth truck movement on the tracking map (like the vehicle in a ride app).
 *
 * The map gets a new truck position only every few seconds. Instead of jumping,
 * the truck DRIVES from the old position to the new one ALONG THE ROAD ROUTE,
 * over about the time between two positions, turning with the road. The piece
 * it drives over is returned as `trail` and drawn gray on top of the blue line,
 * so the line behind the truck is always gray.
 *
 * No React / maps imports: time and the frame timer are injected (unit tests).
 */
import type { TrackerState } from '../services/routeTracker';
import { bearing, dedupePath, meters, projectOnPath, Pt } from './routeGeometry';

export interface DisplayState extends TrackerState {
  /** Road piece the truck is driving over right now (gray, on top of the blue line). */
  trail: Pt[];
  /** Where the truck is driving to (camera follows this, not every frame). */
  truckTarget: Pt | null;
  /** Time the current move takes, ms (0 = not moving). */
  moveMs: number;
}

const FRAME_MS = 66; // ~15 frames per second: smooth, light on the phone
const MIN_MOVE_M = 2; // smaller changes are GPS noise: no animation
const MAX_MOVE_M = 3000; // further than this is a jump (old position, another trip)
const MIN_DURATION_MS = 900;
const MAX_DURATION_MS = 12000;
const FIRST_DURATION_MS = 2500;
const ROUTE_SNAP_M = 30;

interface MovePlan {
  path: Pt[];
  /** Distance from the start of the path to each point, meters. */
  cum: number[];
  length: number;
  /** true when the path follows the route (then it is drawn as travelled). */
  onRoute: boolean;
}

function makePlan(path: Pt[], onRoute: boolean): MovePlan {
  const clean = dedupePath(path);
  const cum: number[] = [0];
  for (let i = 1; i < clean.length; i++) cum.push(cum[i - 1] + meters(clean[i - 1], clean[i]));
  return { path: clean, cum, length: cum[cum.length - 1] ?? 0, onRoute };
}

/** The road from `from` to `to`: along the remaining route when both are on it. */
export function planMove(from: Pt, to: Pt, blue: Pt[]): MovePlan {
  if (blue.length > 1 && meters(blue[0], from) <= ROUTE_SNAP_M) {
    const projection = projectOnPath(blue, to, MAX_MOVE_M * 2);
    if (projection && projection.dist <= ROUTE_SNAP_M && projection.along >= 1) {
      const path = [from].concat(blue.slice(1, projection.index + 1), [projection.point]);
      return makePlan(path, true);
    }
  }
  return makePlan([from, to], false);
}

/** Point `d` meters along the plan, and the direction of the road there. */
export function pointAlong(plan: MovePlan, d: number): { point: Pt; heading: number | null; index: number } {
  const { path, cum } = plan;
  if (path.length === 0) return { point: { lat: 0, lng: 0 }, heading: null, index: 0 };
  if (path.length === 1 || d <= 0) {
    return { point: path[0], heading: path.length > 1 ? bearing(path[0], path[1]) : null, index: 0 };
  }
  if (d >= plan.length) {
    const n = path.length - 1;
    return { point: path[n], heading: meters(path[n - 1], path[n]) > 0.5 ? bearing(path[n - 1], path[n]) : null, index: n - 1 };
  }
  // Binary search for the segment that contains d.
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi] - cum[lo];
  const t = segLen > 0 ? (d - cum[lo]) / segLen : 0;
  const a = path[lo];
  const b = path[hi];
  return {
    point: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
    heading: segLen > 0.5 ? bearing(a, b) : null,
    index: lo,
  };
}

/** The part of the plan between d0 and d1 meters. */
export function slicePlan(plan: MovePlan, d0: number, d1: number): Pt[] {
  if (d1 <= d0 || plan.path.length < 2) return [];
  const start = pointAlong(plan, d0);
  const end = pointAlong(plan, d1);
  const middle = plan.path.slice(start.index + 1, end.index + 1).filter((_, i) => {
    const c = plan.cum[start.index + 1 + i];
    return c > d0 && c < d1;
  });
  return [start.point].concat(middle, [end.point]);
}

/** Turns `from` towards `to` by at most `share` of the angle (shortest way round). */
function turnTowards(from: number, to: number, share: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * share + 360) % 360;
}

export type FrameTimer = (callback: () => void, ms: number) => () => void;

const defaultTimer: FrameTimer = (callback, ms) => {
  const id = setTimeout(callback, ms);
  return () => clearTimeout(id);
};

export class TruckAnimator {
  /** Lines currently drawn. */
  private base: TrackerState | null = null;
  /** State to show when the current move ends. */
  private target: TrackerState | null = null;

  private plan: MovePlan | null = null;
  private startAt = 0;
  private duration = 0;
  /** First meters of the plan that are already drawn gray (left over from the previous move). */
  private carry = 0;
  private heading = 0;
  private lastMoveAt = 0;
  private cancelFrame: (() => void) | null = null;
  private disposed = false;

  constructor(
    private readonly onFrame: (state: DisplayState) => void,
    private readonly now: () => number = () => Date.now(),
    private readonly timer: FrameTimer = defaultTimer
  ) {}

  dispose(): void {
    this.disposed = true;
    this.stop();
  }

  /** Forget everything (another dispatch / journey phase). */
  reset(): void {
    this.stop();
    this.base = null;
    this.target = null;
    this.lastMoveAt = 0;
  }

  private stop(): void {
    if (this.cancelFrame) this.cancelFrame();
    this.cancelFrame = null;
    this.plan = null;
    this.carry = 0;
  }

  private emit(state: DisplayState): void {
    if (!this.disposed) this.onFrame(state);
  }

  /** Show a state at once, without animation. */
  private snap(state: TrackerState): void {
    this.stop();
    this.base = state;
    this.target = state;
    this.heading = state.heading;
    // The first live position starts the clock for the next move.
    if (state.truck && state.live && !this.lastMoveAt) this.lastMoveAt = this.now();
    this.emit({ ...state, trail: [], truckTarget: state.truck, moveMs: 0 });
  }

  private progress(): number {
    if (!this.plan) return 0;
    const t = this.duration > 0 ? (this.now() - this.startAt) / this.duration : 1;
    return Math.max(0, Math.min(1, t)) * this.plan.length;
  }

  /** A new picture from the RouteTracker. */
  push(next: TrackerState): void {
    if (this.disposed) return;

    const previous = this.target;
    if (!next.ready || !next.truck || !next.live || !previous || !previous.ready || !previous.truck) {
      this.snap(next);
      return;
    }

    const moved = meters(previous.truck, next.truck);

    // Only the lines changed (new route, a road piece arrived): keep driving.
    if (moved < MIN_MOVE_M) {
      if (this.plan) {
        this.target = next;
        this.base = next;
        this.carry = this.plan.length; // lines are already up to date: no trail overlay
      } else {
        this.snap(next);
      }
      return;
    }

    if (moved > MAX_MOVE_M) {
      this.snap(next);
      return;
    }

    const step = planMove(previous.truck, next.truck, previous.blue);
    const now = this.now();

    let path = step.path;
    let carry = 0;
    const onRoute = step.onRoute;
    if (this.plan) {
      // Still driving to the previous position: continue from where the truck is.
      const done = this.progress();
      const rest = slicePlan(this.plan, done, this.plan.length);
      if (rest.length > 1) {
        const restPlan = makePlan(rest, true);
        carry = restPlan.length;
        path = rest.concat(step.path.slice(1));
      }
    }

    const elapsed = this.lastMoveAt ? now - this.lastMoveAt : FIRST_DURATION_MS;
    this.lastMoveAt = now;

    this.base = previous;
    this.target = next;
    this.plan = makePlan(path, onRoute);
    this.carry = carry;
    this.startAt = now;
    this.duration = Math.max(MIN_DURATION_MS, Math.min(MAX_DURATION_MS, elapsed));

    if (this.cancelFrame) this.cancelFrame();
    this.cancelFrame = null;
    this.frame();
  }

  private frame = (): void => {
    this.cancelFrame = null;
    const plan = this.plan;
    const base = this.base;
    const target = this.target;
    if (this.disposed || !plan || !base || !target) return;

    const d = this.progress();
    if (d >= plan.length) {
      this.snap(target);
      return;
    }

    const at = pointAlong(plan, d);
    if (at.heading !== null) this.heading = turnTowards(this.heading, at.heading, 0.45);

    const left = plan.length - d;
    this.emit({
      ...base,
      live: true,
      truck: at.point,
      heading: this.heading,
      trail: plan.onRoute && d > this.carry ? slicePlan(plan, this.carry, d) : [],
      remainingM: target.remainingM !== null ? target.remainingM + left : base.remainingM,
      remainingMs: target.remainingMs,
      truckTarget: target.truck,
      moveMs: this.duration,
    });

    this.cancelFrame = this.timer(this.frame, FRAME_MS);
  };
}

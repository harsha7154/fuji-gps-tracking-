/**
 * Map geometry helpers (plain {lat, lng} points, distances in meters).
 * Same maths as the web Dispatch Tracker (dispatch-tracker.jsp) so the
 * mobile map and the web map draw the same lines.
 */

export interface Pt {
  lat: number;
  lng: number;
}

export function isValidPt(p: Pt | null | undefined): p is Pt {
  return (
    !!p &&
    Number.isFinite(p.lat) &&
    Number.isFinite(p.lng) &&
    Math.abs(p.lat) <= 90 &&
    Math.abs(p.lng) <= 180 &&
    !(p.lat === 0 && p.lng === 0)
  );
}

/** [lat, lng] tuple -> Pt, or null when it is empty / invalid. */
export function tupleToPt(t: [number, number] | null | undefined): Pt | null {
  if (!t) return null;
  const p = { lat: Number(t[0]), lng: Number(t[1]) };
  return isValidPt(p) ? p : null;
}

/** "17.495081, 78.356272" -> Pt, or null. */
export function parseLatLngString(value: unknown): Pt | null {
  if (typeof value !== 'string') return null;
  const parts = value.split(',').map((s) => Number(s.trim()));
  if (parts.length < 2) return null;
  const p = { lat: parts[0], lng: parts[1] };
  return isValidPt(p) ? p : null;
}

export function meters(a: Pt, b: Pt): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Compass bearing a -> b in degrees (0 = north, 90 = east). */
export function bearing(a: Pt, b: Pt): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function pathLength(path: Pt[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += meters(path[i - 1], path[i]);
  return total;
}

export interface Projection {
  /** Index of the path segment (index -> index + 1) the point falls on. */
  index: number;
  /** Distance from the point to the path, meters. */
  dist: number;
  /** Distance along the path up to the projected point, meters. */
  along: number;
  /** The point on the path nearest to p. */
  point: Pt;
}

/**
 * Nearest point of a path to p. With maxAlong, only the first maxAlong meters
 * of the path are searched (the truck cannot be further ahead than that).
 */
export function projectOnPath(path: Pt[], p: Pt, maxAlong?: number): Projection | null {
  if (path.length < 2) return null;
  const kx = 111320 * Math.cos((p.lat * Math.PI) / 180);
  const ky = 110540;
  let best: Projection | null = null;
  let along = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const ax = (path[i].lng - p.lng) * kx;
    const ay = (path[i].lat - p.lat) * ky;
    const dx = (path[i + 1].lng - path[i].lng) * kx;
    const dy = (path[i + 1].lat - path[i].lat) * ky;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    const d = Math.sqrt(cx * cx + cy * cy);
    const len = Math.sqrt(len2);
    if (!best || d < best.dist) {
      best = {
        index: i,
        dist: d,
        along: along + len * t,
        point: {
          lat: path[i].lat + (path[i + 1].lat - path[i].lat) * t,
          lng: path[i].lng + (path[i + 1].lng - path[i].lng) * t,
        },
      };
    }
    along += len;
    if (maxAlong && along > maxAlong) break;
  }
  return best;
}

/** Stored pings used as route points: at least 150 m apart, at most 90 of them. */
export function thinPings<T extends Pt>(pings: T[]): T[] {
  let kept: T[] = [];
  pings.forEach((p, i) => {
    if (!kept.length || i === pings.length - 1 || meters(kept[kept.length - 1], p) >= 150) kept.push(p);
  });
  if (kept.length > 90) {
    const sampled: T[] = [];
    for (let i = 0; i < 90; i++) sampled.push(kept[Math.round((i * (kept.length - 1)) / 89)]);
    kept = sampled;
  }
  return kept;
}

/** Drops consecutive duplicate points. */
export function dedupePath(path: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of path) {
    const last = out[out.length - 1];
    if (!last || last.lat !== p.lat || last.lng !== p.lng) out.push(p);
  }
  return out;
}

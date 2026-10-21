/**
 * Dispatch status (`statusDispatch`) — single source of truth.
 *
 * Lifecycle, as returned by GET /o/material-dispatch-rest/dispatches and by
 * the live GPS cache (Redis):
 *
 *   3 · Dispatched  --start-journey-->  1 · In Transit  --(<= 100 m from site)-->  0 · Arrived
 *
 * NOTE: `0` is a real, meaningful value ("Arrived"). Never test this field
 * with a truthiness check (`if (d.statusDispatch)`) — always compare against
 * DISPATCH_STATUS or use the helpers below.
 */

export const DISPATCH_STATUS = {
  ARRIVED: 0,
  IN_TRANSIT: 1,
  DISPATCHED: 3,
} as const;

export type KnownDispatchStatus = (typeof DISPATCH_STATUS)[keyof typeof DISPATCH_STATUS];

const STATUS_LABELS: Record<KnownDispatchStatus, string> = {
  [DISPATCH_STATUS.DISPATCHED]: 'Dispatched',
  [DISPATCH_STATUS.IN_TRANSIT]: 'In Transit',
  [DISPATCH_STATUS.ARRIVED]: 'Arrived',
};

/** Coerces API values ("1", 1, null, undefined…) into a finite number or undefined. */
export function toStatusCode(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

/**
 * Resolves the effective status of a raw dispatch row.
 *
 * `statusDispatch` is authoritative. Only when the API omitted it do we fall
 * back to the legacy `arrived` flag / `statusLabel`, so older payloads keep
 * working. Returns undefined when the status genuinely can't be determined.
 */
export function resolveDispatchStatus(raw: {
  statusDispatch?: unknown;
  arrived?: unknown;
  statusLabel?: unknown;
}): number | undefined {
  const code = toStatusCode(raw.statusDispatch);
  if (code !== undefined) return code;

  if (raw.arrived === true) return DISPATCH_STATUS.ARRIVED;

  const label = typeof raw.statusLabel === 'string' ? raw.statusLabel.trim().toLowerCase() : '';
  if (label === 'arrived' || label === 'delivered') return DISPATCH_STATUS.ARRIVED;
  if (label === 'in transit') return DISPATCH_STATUS.IN_TRANSIT;
  if (label === 'dispatched') return DISPATCH_STATUS.DISPATCHED;

  return undefined;
}

export const isDispatched = (code?: number): boolean => code === DISPATCH_STATUS.DISPATCHED;
export const isInTransit = (code?: number): boolean => code === DISPATCH_STATUS.IN_TRANSIT;
export const isArrivedStatus = (code?: number): boolean => code === DISPATCH_STATUS.ARRIVED;

export function getDispatchStatusLabel(code?: number): string {
  if (code === undefined) return 'Unknown';
  return STATUS_LABELS[code as KnownDispatchStatus] ?? `Status ${code}`;
}

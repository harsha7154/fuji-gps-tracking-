/**
 * Truck Driver dashboard types.
 *
 * `DispatchItem` / `MaterialDispatchResponse` mirror the real Liferay
 * REST endpoint response:
 *   GET {baseURL}/o/material-dispatch-rest/dispatches?userId={id}
 *
 * Fields the current backend doesn't always send (objectEntryId, deviceID,
 * statusLabel, …) are optional so a missing field can never crash a screen.
 *
 * `statusDispatch` is the field that drives the driver flow — see
 * `src/utils/dispatchStatus.ts` (3 = Dispatched, 1 = In Transit, 0 = Arrived).
 *
 * `DriverDashboardData` is what DriverDashboardScreen actually renders —
 * built by driverDashboardService.getDriverDashboard() from that API
 * response for the logged-in driver's userId.
 */

export type DutyStatus = 'ON_DUTY' | 'OFF_DUTY';

export interface DriverInfo {
  name: string;
  vehicleNumber: string;
  /** Not provided by the dispatches API — left empty until a source exists. */
  vehicleModel: string;
  dutyStatus: DutyStatus;
  avatarInitials: string;
}

/** One stored GPS point, as returned in `pingHistory` by GET /dispatch/{objectEntryId}. */
export interface DispatchPingHistoryItem {
  latitude: number;
  longitude: number;
  deviceId?: string;
  speed?: number;
  /** e.g. "2026-09-30 06:45:46" */
  timestamp?: string;
}

/**
 * One row of `GET /o/material-dispatch-rest/dispatches` → `items[]`
 * (same shape as `driver/active-dispatch` and `dispatch/{objectEntryId}`).
 *
 * Dynamic params used by the journey APIs come from here:
 *   dispatchID          -> {dispatchId}     (WebSocket URL, live tracking)
 *   MaterialDispatchId  -> {objectEntryId}  (dispatch detail, start/complete journey)
 *   vehicleNumber       -> {vehicleId}      (WebSocket GPS message)
 */
export interface DispatchItem {
  dispatchID: string;
  /** Liferay object entry id of the dispatch. The API's name for {objectEntryId}. */
  MaterialDispatchId?: number;
  /** Always filled by normalizeDispatch() from MaterialDispatchId when the API omits it. */
  objectEntryId?: number;
  /** Only on GET /dispatch/{objectEntryId}. */
  pingHistory?: DispatchPingHistoryItem[];
  siteMasterObjectEntryId?: number;
  siteName: string;
  destinationSiteAWC: string;
  destinationPin?: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
  distancekm: string;
  distanceToDestinationKm?: string;
  distanceToDestinationMeters?: string;
  quantity: string;
  elementMaterial: string;
  productName: string;
  vehicleNumber: string;
  driverName: string;
  startLocationGPS: string;
  plantObjectEntryId?: number;
  plantName: string;
  /** Plant coordinates, when the API sends them (otherwise startLocationGPS is used as the start point). */
  plantLatitude?: number;
  plantLongitude?: number;
  deliveryDate: string;
  deviceID?: string;
  /** Epoch millis as a string, e.g. "1790588471455". */
  timestamp?: string;

  /**
   * 3 = Dispatched, 1 = In Transit, 0 = Arrived.
   * Always populated by driverDashboardService (normalised) when derivable.
   */
  statusDispatch?: number;
  /** Legacy numeric status — NOT the same as statusDispatch. Don't drive UI from it. */
  status?: number;
  /** Legacy text label. Only used as a fallback when statusDispatch is absent. */
  statusLabel?: string;
  arrived?: boolean;
  trackingActive?: boolean;
  nextStepAllowed?: boolean;
}

/** Raw shape of the `/o/material-dispatch-rest/dispatches` response. */
export interface MaterialDispatchResponse {
  driverFullName: string;
  pageSize: number;
  page: number;
  totalCount: number;
  items: DispatchItem[];
  userId: string;
}

export type DriverWorkflowKey = 'tripHistory' | 'preTripInspection' | 'proofOfDelivery' | 'notifications';

export interface DriverWorkflow {
  key: DriverWorkflowKey;
  label: string;
  sublabel: string;
}

export interface DriverDashboardData {
  driver: DriverInfo;
  /** All dispatches (sites) currently assigned to this driver's userId. */
  dispatches: DispatchItem[];
  workflows: DriverWorkflow[];
  notificationCount: number;
}

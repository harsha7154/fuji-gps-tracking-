/**
 * Types for the Truck Driver workflow screens: Notifications, Live GPS
 * Tracking, and Proof of Delivery (POD) + POD Submitted (success).
 *
 * Backed by mock data in `driverWorkflowService.ts`. Swap the service
 * internals for real Liferay / dispatch-system calls once available; the
 * screens only depend on these types.
 */

// ───────────────────────────── Notifications ─────────────────────────────

export type DriverNotificationCategory = 'trip' | 'compliance' | 'traffic' | 'maintenance';

export interface DriverNotification {
  id: string;
  category: DriverNotificationCategory;
  type?: string;
  read?: boolean;
  highlighted?: boolean;
  title: string;
  message: string;
  timeAgo: string;
}

// ───────────────────────────── Live GPS Tracking ─────────────────────────────

export type CorridorStatus = 'GREEN' | 'CAUTION' | 'CONGESTED';

export interface LiveTripTracking {
  tripId: string;
  fromLabel: string;
  siteCode: string;
  gpsSatellites: number;
  gpsAccuracyM: number;
  speedLimitKmh: number;
  etaMinutes: number;
  etaClockLabel: string;
  distanceLeftKm: number;
  speedKmh: number;
  corridorStatus: CorridorStatus;
}

export interface DriverGpsTrackingData {
  tripId: string;
  vehicleNumber: string;
  fromName: string;
  toCode: string;
  toName: string;
  distanceLeftKm: number;
  etaMinutes: number;
  etaClockLabel: string;
  speedKmh: number;
  speedLimitKmh: number;
  gpsAccuracyLabel: string;
  satelliteCount: number;
  corridorStatusLabel: string;
}

// ───────────────────────────── Proof of Delivery (POD) ─────────────────────────────

export interface PodChecklistItem {
  id: string;
  label: string;
  checked: boolean;
}

export type DriverPodCargoCheckItem = PodChecklistItem;

export interface PodReceiver {
  name: string;
  role: string;
  empId: string;
}

export interface PodTripSummary {
  tripId: string;
  siteCode: string;
  siteName: string;
  receiver: PodReceiver;
  cargoSummary: string;
  cargoWeightTons: number;
  vehicleNumber: string;
  driverName: string;
  checklist: PodChecklistItem[];
  objectEntryId?: number | string;
  dispatchId?: string;
  eWayBillNumber?: string;
}

export interface DriverPodTripSummary {
  tripId: string;
  siteCode: string;
  siteName: string;
  cargoSummary: string;
  cargoWeightTons: number;
  receiverName: string;
  receiverTitle: string;
  cargoChecklist: DriverPodCargoCheckItem[];
  objectEntryId?: number | string;
  dispatchId?: string;
}

export interface SubmitProofOfDeliveryParams {
  tripId: string;
  photosCount: number;
  signed: boolean;
  objectEntryId?: string | number;
  photos?: any[];
  accessToken?: string;
}

export interface PodSubmissionResult {
  referenceId: string;
  eWayBillNumber: string;
  photosCount: number;
  objectEntryId?: string;
  podFileEntryId?: string;
  podFileEntryIds?: string[];
  message?: string;
  dispatchId?: string;
  success?: boolean;
}

export interface DriverPodSubmissionResult {
  referenceId: string;
  ewbNumber: string;
  destinationSite: string;
  receiverSignOff: string;
  cargoInspected: string;
  evidenceCount: number;
  vehicleAndDriver: string;
  objectEntryId?: string;
  podFileEntryId?: string;
  podFileEntryIds?: string[];
  message?: string;
  dispatchId?: string;
}
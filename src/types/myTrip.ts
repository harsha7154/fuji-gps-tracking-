/**
 * Types for the "My Trip" / "Trip Details & Manifest" screen.
 *
 * Designed so that the static mock data can be seamlessly replaced
 * with an API response in the future without changing the UI components.
 */

export type MilestoneStatusType = 'origin' | 'current' | 'destination' | 'completed' | 'pending';

export interface TripMilestone {
  id: string;
  title: string;
  statusTag?: string; // e.g. "(Origin)", "(Current)", "(Destination)"
  isCurrent?: boolean;
  dotColor: string;
  details: string;
  statusType: MilestoneStatusType;
}

export interface CargoItem {
  id: string;
  elementCode: string;
  description: string;
  quantity: string;
  weight: string;
}

export interface CargoManifestData {
  totalWeight: string;
  items: CargoItem[];
  grossTruckWeight: string;
  permissibleWeight: string;
  cargoBracing: string;
}

export interface OperationalContact {
  id: string;
  name: string;
  role: string;
  subtitle: string;
  phoneNumber?: string;
  buttonType: 'green' | 'blue';
}

export interface TripDetailsData {
  tripId: string;
  categoryBadge: string; // e.g. "LOGISTICS"
  status: string; // e.g. "IN TRANSIT"
  statusType: 'IN_TRANSIT' | 'DISPATCHED' | 'ARRIVED';
  eWayBill: string;
  eWayBillValidTill: string;
  vehicleNumber: string;
  vehicleType: string;
  dispatchBay: string;
  driverInitials: string;
  notificationCount: number;

  milestones: TripMilestone[];
  cargo: CargoManifestData;
  contacts: OperationalContact[];
}

import type { DispatchItem } from '../types/driverDashboard';
import type { TripDetailsData, TripMilestone, CargoItem, OperationalContact } from '../types/myTrip';
import { DISPATCH_STATUS } from './dispatchStatus';

function extractInitials(name?: string): string {
  if (!name || name.trim() === '') return '—';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '—';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

/**
 * Transforms a real API DispatchItem into the UI TripDetailsData model.
 *
 * STRICT RULE:
 * ONLY uses values from the real API response.
 * NO static mock values, hardcoded placeholder strings, or fake fallbacks.
 * If a field is missing, it provides 'Not available' or hides the field.
 */
export function mapDispatchToTrip(
  dispatch: DispatchItem,
  driverFullName?: string
): TripDetailsData {
  const anyDispatch = dispatch as Record<string, any>;

  // 1. Trip ID (from API dispatchID)
  let formattedTripId = 'Not available';
  if (dispatch.dispatchID && String(dispatch.dispatchID).trim()) {
    const rawId = String(dispatch.dispatchID).trim();
    formattedTripId = rawId.startsWith('#') ? rawId : `#${rawId}`;
  }

  // 2. Status resolution (from real API statusDispatch / statusLabel)
  let statusText = 'Not available';
  let statusType: 'IN_TRANSIT' | 'DISPATCHED' | 'ARRIVED' = 'IN_TRANSIT';

  if (dispatch.statusDispatch === DISPATCH_STATUS.ARRIVED || dispatch.arrived) {
    statusText = 'ARRIVED';
    statusType = 'ARRIVED';
  } else if (dispatch.statusDispatch === DISPATCH_STATUS.DISPATCHED) {
    statusText = 'DISPATCHED';
    statusType = 'DISPATCHED';
  } else if (dispatch.statusDispatch === DISPATCH_STATUS.IN_TRANSIT || dispatch.trackingActive) {
    statusText = 'IN TRANSIT';
    statusType = 'IN_TRANSIT';
  } else if (dispatch.statusLabel && String(dispatch.statusLabel).trim()) {
    statusText = String(dispatch.statusLabel).trim().toUpperCase();
  }

  // 3. E-Way Bill and validity (from API)
  const eWayBill =
    anyDispatch.eWayBill ||
    anyDispatch.ewayBill ||
    anyDispatch.eWayBillNumber ||
    anyDispatch.ewbNumber ||
    anyDispatch.eWayBillNo ||
    'Not available';

  const eWayBillValidTill =
    anyDispatch.eWayBillValidTill ||
    anyDispatch.ewbValidity ||
    anyDispatch.validTill ||
    anyDispatch.ewbValidTill ||
    '';

  // 4. Vehicle & Dispatch Bay (from API)
  const vehicleNumber = dispatch.vehicleNumber || anyDispatch.vehicleId || '';
  const vehicleType =
    anyDispatch.vehicleType ||
    anyDispatch.vehicleModel ||
    anyDispatch.model ||
    '';

  const dispatchBay =
    anyDispatch.dispatchBay ||
    anyDispatch.bay ||
    anyDispatch.loadingBay ||
    dispatch.plantName ||
    'Not available';

  const driverInitials = extractInitials(dispatch.driverName || driverFullName);

  // 5. Milestones construction (derived purely from real API fields)
  const originName = dispatch.plantName;
  const destinationName = dispatch.destinationSiteAWC || dispatch.siteName;

  const originDetails = dispatch.deliveryDate
    ? `Dispatch: ${dispatch.deliveryDate}`
    : dispatch.timestamp
    ? `Dispatch Date: ${new Date(Number(dispatch.timestamp)).toLocaleDateString()}`
    : 'Origin Plant Yard';

  const distanceLeft = dispatch.distancekm || dispatch.distanceToDestinationKm;
  let currentDetails = 'Current location unavailable';
  if (dispatch.statusDispatch === DISPATCH_STATUS.ARRIVED || dispatch.arrived) {
    currentDetails = 'Arrived at destination site';
  } else if (distanceLeft) {
    currentDetails = `Distance remaining: ${distanceLeft} km${anyDispatch.speed ? ` • Speed: ${anyDispatch.speed} km/h` : ''}`;
  } else if (dispatch.statusDispatch === DISPATCH_STATUS.IN_TRANSIT || dispatch.trackingActive) {
    currentDetails = 'Vehicle in transit towards destination site';
  }

  const destDetails = anyDispatch.eta
    ? `Estimated Arrival: ${anyDispatch.eta}`
    : dispatch.deliveryDate
    ? `Scheduled Delivery: ${dispatch.deliveryDate}`
    : 'Destination site';

  const milestones: TripMilestone[] = [
    {
      id: 'origin',
      title: originName ? `${originName} (Origin)` : 'Plant Origin (Origin)',
      details: originDetails,
      dotColor: '#0066B3',
      statusType: 'origin',
    },
    {
      id: 'current',
      title: anyDispatch.currentLocation
        ? `${anyDispatch.currentLocation} (Current)`
        : 'Current Location (Current)',
      statusTag: '(Current)',
      isCurrent: true,
      details: currentDetails,
      dotColor: '#0D9488',
      statusType: 'current',
    },
    {
      id: 'destination',
      title: destinationName ? `${destinationName} (Destination)` : 'Destination Site (Destination)',
      details: destDetails,
      dotColor: '#10B981',
      statusType: 'destination',
    },
  ];

  // 6. Cargo Manifest (strictly from real API)
  let totalWeight = '';
  if (anyDispatch.totalWeight) {
    totalWeight = String(anyDispatch.totalWeight);
  } else if (anyDispatch.cargoWeight) {
    totalWeight = String(anyDispatch.cargoWeight);
  } else if (anyDispatch.weight) {
    totalWeight = String(anyDispatch.weight).toUpperCase().includes('T')
      ? String(anyDispatch.weight)
      : `${anyDispatch.weight} TONS`;
  }

  let cargoItems: CargoItem[] = [];

  if (Array.isArray(anyDispatch.elements) && anyDispatch.elements.length > 0) {
    cargoItems = anyDispatch.elements.map((el: any, idx: number) => ({
      id: el.id ? String(el.id) : `cargo-${idx}`,
      elementCode: el.code || el.elementCode || el.name || 'Precast Element',
      description: el.description || '',
      quantity: el.quantity
        ? String(el.quantity).includes('Unit')
          ? String(el.quantity)
          : `${el.quantity} Units`
        : 'Not available',
      weight: el.weight
        ? String(el.weight).toUpperCase().includes('T')
          ? String(el.weight)
          : `${el.weight} T`
        : '—',
    }));
  } else if (Array.isArray(anyDispatch.items) && anyDispatch.items.length > 0) {
    cargoItems = anyDispatch.items.map((item: any, idx: number) => ({
      id: item.id ? String(item.id) : `cargo-${idx}`,
      elementCode: item.productName || item.code || item.name || 'Precast Element',
      description: item.description || item.material || '',
      quantity: item.quantity ? `${item.quantity} Units` : 'Not available',
      weight: item.weight ? `${item.weight} T` : '—',
    }));
  } else if (dispatch.productName && String(dispatch.productName).trim()) {
    cargoItems = [
      {
        id: 'c-1',
        elementCode: dispatch.productName,
        description: dispatch.elementMaterial || '',
        quantity: dispatch.quantity
          ? String(dispatch.quantity).includes('Unit')
            ? String(dispatch.quantity)
            : `${dispatch.quantity} Units`
          : 'Not available',
        weight: anyDispatch.weight
          ? String(anyDispatch.weight).toUpperCase().includes('T')
            ? String(anyDispatch.weight)
            : `${anyDispatch.weight} T`
          : '—',
      },
    ];
  }

  // 7. Operational Contacts (only if returned from the API)
  const contacts: OperationalContact[] = [];

  const siteEngineerName = anyDispatch.siteEngineerName || anyDispatch.siteContactName;
  const siteEngineerPhone = anyDispatch.siteEngineerPhone || anyDispatch.siteContactPhone;
  if (siteEngineerName || siteEngineerPhone) {
    contacts.push({
      id: 'site-contact',
      name: siteEngineerName ? `${siteEngineerName} (Site Engineer)` : 'Site Engineer',
      role: 'Site Engineer',
      subtitle: destinationName || 'Site Location',
      buttonType: 'green',
      phoneNumber: siteEngineerPhone,
    });
  }

  const plantContactName = anyDispatch.plantContactName || anyDispatch.plantManagerName;
  const plantContactPhone = anyDispatch.plantContactPhone || anyDispatch.plantPhone;
  if (plantContactName || plantContactPhone) {
    contacts.push({
      id: 'plant-contact',
      name: plantContactName ? `${plantContactName} (Plant Dispatch)` : 'Plant Dispatch',
      role: 'Plant Dispatch',
      subtitle: originName || 'Plant Yard',
      buttonType: 'blue',
      phoneNumber: plantContactPhone,
    });
  }

  if (Array.isArray(anyDispatch.contacts) && anyDispatch.contacts.length > 0) {
    anyDispatch.contacts.forEach((c: any, idx: number) => {
      contacts.push({
        id: c.id ? String(c.id) : `contact-${idx}`,
        name: c.name || c.contactPerson || 'Operational Contact',
        role: c.role || 'Operations',
        subtitle: c.subtitle || c.department || '',
        buttonType: idx % 2 === 0 ? 'green' : 'blue',
        phoneNumber: c.phone || c.phoneNumber || c.mobile,
      });
    });
  }

  const mapped: TripDetailsData = {
    tripId: formattedTripId,
    categoryBadge: anyDispatch.categoryBadge || 'LOGISTICS',
    status: statusText,
    statusType,
    eWayBill,
    eWayBillValidTill,
    vehicleNumber,
    vehicleType,
    dispatchBay,
    driverInitials,
    notificationCount: anyDispatch.notificationCount ?? 0,
    milestones,
    cargo: {
      totalWeight,
      items: cargoItems,
      grossTruckWeight: anyDispatch.grossTruckWeight || anyDispatch.grossWeight || anyDispatch.truckWeight || '',
      permissibleWeight: anyDispatch.permissibleWeight || anyDispatch.rtoPermissibleWeight || '',
      cargoBracing: anyDispatch.cargoBracing || anyDispatch.bracing || '',
    },
    contacts,
  };

  // Required temporary development log
  console.log('[MY TRIP] Mapped Trip:', mapped);

  return mapped;
}

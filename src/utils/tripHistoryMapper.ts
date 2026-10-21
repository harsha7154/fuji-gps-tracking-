import type { DispatchItem } from '../types/driverDashboard';
import type {
  TripHistoryItem,
  TripHistoryStatus,
  TripHistorySummary,
} from '../types/tripHistory';
import { DISPATCH_STATUS, resolveDispatchStatus } from './dispatchStatus';

function formatDateString(dateValue?: string, timestamp?: string): string {
  if (dateValue && typeof dateValue === 'string') {
    const trimmed = dateValue.trim();
    if (/^today$/i.test(trimmed) || trimmed.toLowerCase().startsWith('today')) {
      return trimmed;
    }
    const parsed = new Date(trimmed);
    if (!isNaN(parsed.getTime())) {
      const isToday = new Date().toDateString() === parsed.toDateString();
      if (isToday) {
        const timeStr = parsed.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        return `Today, ${timeStr}`;
      }
      const day = String(parsed.getDate()).padStart(2, '0');
      const monthNames = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      ];
      const month = monthNames[parsed.getMonth()];
      const year = parsed.getFullYear();
      return `${day}-${month}-${year}`;
    }
    return trimmed;
  }

  if (timestamp) {
    const num = Number(timestamp);
    if (!isNaN(num) && num > 0) {
      const parsed = new Date(num);
      const isToday = new Date().toDateString() === parsed.toDateString();
      if (isToday) {
        const timeStr = parsed.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
        return `Today, ${timeStr}`;
      }
      const day = String(parsed.getDate()).padStart(2, '0');
      const monthNames = [
        'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
        'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
      ];
      const month = monthNames[parsed.getMonth()];
      const year = parsed.getFullYear();
      return `${day}-${month}-${year}`;
    }
  }

  return '';
}

/**
 * Maps a single real API DispatchItem into a TripHistoryItem.
 */
export function mapDispatchToHistoryItem(dispatch: DispatchItem): TripHistoryItem {
  const anyDispatch = dispatch as Record<string, any>;

  // 1. ID & formatted trip ID
  const rawId = String(
    dispatch.dispatchID ||
      dispatch.MaterialDispatchId ||
      dispatch.objectEntryId ||
      ''
  ).trim();
  const tripIdFormatted = rawId ? (rawId.startsWith('#') ? rawId : `#${rawId}`) : '—';
  const id = dispatch.dispatchID || String(dispatch.objectEntryId || dispatch.MaterialDispatchId || rawId);

  // 2. Status resolution (DELIVERED vs IN TRANSIT)
  // Strict rules:
  // statusDispatch 0 -> DELIVERED
  // statusDispatch 3 (or 1) -> IN TRANSIT
  const statusCode = resolveDispatchStatus(dispatch);
  const isDelivered =
    statusCode === DISPATCH_STATUS.ARRIVED ||
    dispatch.statusDispatch === 0 ||
    String(dispatch.statusDispatch) === '0' ||
    dispatch.arrived === true ||
    /^delivered$/i.test(dispatch.statusLabel ?? '') ||
    /^arrived$/i.test(dispatch.statusLabel ?? '');

  const status: TripHistoryStatus = isDelivered ? 'DELIVERED' : 'IN TRANSIT';

  // 3. Destination formatting (strictly from API)
  const siteName = (dispatch.siteName ?? '').trim();
  const awc = (dispatch.destinationSiteAWC ?? '').trim();
  let destination = 'Site Location';
  if (siteName && awc) {
    destination = siteName.includes(awc) ? siteName : `${siteName} (${awc})`;
  } else if (awc) {
    destination = awc;
  } else if (siteName) {
    destination = siteName;
  }

  // 4. Trip Information Line (Date • Cargo (Weight) • Origin/Status)
  // Part A: Date / Time
  const dateStr = formatDateString(dispatch.deliveryDate, dispatch.timestamp);

  // Part B: Cargo & Weight (strictly from API, no hardcoded fallbacks)
  const cargoName =
    dispatch.productName ||
    dispatch.elementMaterial ||
    anyDispatch.cargo ||
    anyDispatch.material ||
    '';

  let quantityStr = '';
  if (dispatch.quantity) {
    const qStr = String(dispatch.quantity).trim();
    if (qStr.endsWith('x') || qStr.toLowerCase().includes('unit') || qStr.toLowerCase().includes('panel')) {
      quantityStr = qStr;
    } else {
      quantityStr = `${qStr}x`;
    }
  }

  const rawWeight =
    anyDispatch.totalWeight ||
    anyDispatch.cargoWeight ||
    anyDispatch.weight;
  let weightStr = '';
  if (rawWeight) {
    const wStr = String(rawWeight).trim();
    weightStr = wStr.toUpperCase().includes('T') ? `(${wStr})` : `(${wStr} T)`;
  }

  const cargoSegment = [quantityStr, cargoName, weightStr].filter(Boolean).join(' ');

  // Part C: Location / Delivery info (strictly from API)
  let thirdSegment = '';
  if (isDelivered) {
    const deliveryTime =
      anyDispatch.deliveryTime ||
      anyDispatch.deliveredAt ||
      anyDispatch.actualDeliveryTime;
    if (deliveryTime) {
      thirdSegment = `Delivered ${deliveryTime}`;
    } else {
      thirdSegment = 'Delivered';
    }
  } else {
    thirdSegment = dispatch.plantName || anyDispatch.origin || '';
  }

  const tripInfoParts = [dateStr, cargoSegment, thirdSegment].filter(Boolean);
  const tripInfo = tripInfoParts.length > 0 ? tripInfoParts.join(' • ') : '—';

  // 5. Bottom left label and type (POD vs E-Way Bill)
  // Strict rules:
  // - "✓ POD Signed": Do not invent if not present in dispatches API response.
  // - "EWB-DSP-456359": Do not invent by prepending "EWB-" to dispatchID.
  // If not present in the dispatches API, hide them or mark as unavailable.
  let bottomLeftLabel = '';
  let bottomLeftType: 'ewb' | 'pod' | 'none' = 'none';

  if (isDelivered) {
    const hasPodSigned =
      anyDispatch.podSigned === true ||
      anyDispatch.isPodSigned === true ||
      String(anyDispatch.podStatus || '').toUpperCase() === 'SIGNED';

    const signer =
      anyDispatch.podSignedBy ||
      anyDispatch.signedBy;

    if (hasPodSigned || (signer && typeof signer === 'string' && signer.trim())) {
      bottomLeftType = 'pod';
      if (signer && typeof signer === 'string' && signer.trim()) {
        const trimmedSigner = signer.trim();
        const engineerLabel = trimmedSigner.toLowerCase().startsWith('engg')
          ? trimmedSigner
          : `Engg ${trimmedSigner}`;
        bottomLeftLabel = `✓ POD Signed (${engineerLabel})`;
      } else {
        bottomLeftLabel = '✓ POD Signed';
      }
    } else {
      // POD status is NOT in the dispatches API response.
      // Do NOT invent "✓ POD Signed". Leave empty to hide it cleanly.
      bottomLeftLabel = '';
      bottomLeftType = 'none';
    }
  } else {
    const ewbRaw =
      anyDispatch.eWayBill ||
      anyDispatch.ewayBill ||
      anyDispatch.eWayBillNumber ||
      anyDispatch.ewbNumber ||
      anyDispatch.eWayBillNo;

    if (ewbRaw && String(ewbRaw).trim()) {
      const ewbClean = String(ewbRaw).trim();
      bottomLeftType = 'ewb';
      bottomLeftLabel = ewbClean.startsWith('EWB-') ? ewbClean : `EWB-${ewbClean}`;
    } else {
      // E-Way Bill is NOT in the dispatches API response.
      // Do NOT invent "EWB-" + rawId ("EWB-DSP-456359"). Leave empty to hide it cleanly.
      bottomLeftLabel = '';
      bottomLeftType = 'none';
    }
  }

  // 6. Action type & label
  // Strict rule:
  // - "Receipt PDF ↓": Do not invent if receipt availability is not in the API response.
  // If receipt is not present, use "View Details →" so driver can view full dispatch details.
  const receiptUrl =
    anyDispatch.receiptUrl ||
    anyDispatch.receiptPdfUrl ||
    anyDispatch.receiptDocumentUrl;

  const hasReceipt = Boolean(
    receiptUrl ||
      anyDispatch.receiptFileEntryId ||
      anyDispatch.hasReceipt === true
  );

  let actionType: 'viewDetails' | 'receiptPdf' = 'viewDetails';
  let actionLabel = 'View Details →';

  if (isDelivered && hasReceipt) {
    actionType = 'receiptPdf';
    actionLabel = 'Receipt PDF ↓';
  } else {
    actionType = 'viewDetails';
    actionLabel = 'View Details →';
  }

  return {
    id,
    tripIdFormatted,
    status,
    destination,
    tripInfo,
    bottomLeftLabel,
    bottomLeftType,
    actionType,
    actionLabel,
    receiptUrl: receiptUrl || undefined,
    dispatchId: dispatch.dispatchID || rawId,
  };
}

/**
 * Transforms an array of DispatchItems from the real API response
 * into a TripHistorySummary UI model.
 */
export function mapDispatchesToTripHistory(
  items: DispatchItem[],
  totalCount?: number
): TripHistorySummary {
  const safeItems = Array.isArray(items) ? items : [];
  const trips = safeItems.map(mapDispatchToHistoryItem);

  const deliveredCount = trips.filter((t) => t.status === 'DELIVERED').length;
  const inTransitCount = trips.filter((t) => t.status === 'IN TRANSIT').length;
  const allCount = typeof totalCount === 'number' && totalCount >= trips.length
    ? totalCount
    : trips.length;

  return {
    allCount,
    deliveredCount,
    inTransitCount,
    trips,
  };
}

/**
 * Types for the "Trip History & Logs" screen.
 *
 * Keeps static mock data decoupled from UI components so it can
 * seamlessly be swapped for a real API response later.
 */

export type TripHistoryStatus = 'DISPATCHED' | 'IN TRANSIT' | 'DELIVERED';

export type TripHistoryFilter = 'ALL' | 'DELIVERED' | 'IN_TRANSIT';

export interface TripHistoryItem {
  id: string;
  tripIdFormatted: string;
  status: TripHistoryStatus;
  destination: string;
  tripInfo: string;
  bottomLeftLabel: string;
  bottomLeftType: 'ewb' | 'pod' | 'none';
  actionType: 'viewDetails' | 'receiptPdf';
  actionLabel: string;
  receiptUrl?: string;
  dispatchId?: string;
}

export interface TripHistorySummary {
  allCount: number;
  deliveredCount: number;
  inTransitCount: number;
  trips: TripHistoryItem[];
}

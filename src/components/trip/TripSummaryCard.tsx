import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface TripSummaryCardProps {
  tripId: string;
  status: string;
  statusType?: 'IN_TRANSIT' | 'DISPATCHED' | 'ARRIVED';
  eWayBill: string;
  eWayBillValidTill: string;
  vehicleNumber: string;
  vehicleType: string;
  dispatchBay: string;
}

const STATUS_BADGE_STYLES: Record<string, { bg: string; text: string }> = {
  DISPATCHED: { bg: '#FEF3C7', text: '#D97706' },
  IN_TRANSIT: { bg: '#DCFCE7', text: '#16A34A' },
  ARRIVED: { bg: '#DCFCE7', text: '#16A34A' },
};

/**
 * Trip Summary Card matching Section 3 & design reference:
 * - Rounded white card
 * - Top row: #TRIP-FS-2026-941 (Fuji Blue) + "IN TRANSIT" badge
 * - Vehicle info with model and flatbed spec
 * - Dispatch Bay info
 */
export const TripSummaryCard: React.FC<TripSummaryCardProps> = ({
  tripId,
  status,
  statusType = 'IN_TRANSIT',
  vehicleNumber,
  vehicleType,
  dispatchBay,
}) => {
  const badgeStyle = STATUS_BADGE_STYLES[statusType] ?? STATUS_BADGE_STYLES.IN_TRANSIT;

  return (
    <View style={styles.card}>
      {/* Top Row: Trip ID and Status Badge */}
      <View style={styles.topRow}>
        <Text style={styles.tripIdText}>{tripId}</Text>
        <View style={[styles.statusBadge, { backgroundColor: badgeStyle.bg }]}>
          <Text style={[styles.statusText, { color: badgeStyle.text }]}>{status}</Text>
        </View>
      </View>

      {/* Info Rows */}
      <View style={styles.infoList}>
        {/* Vehicle */}
        <Text style={styles.infoLine}>
          <Text style={styles.boldLabel}>Vehicle: </Text>
          <Text style={styles.valueText}>{vehicleNumber || 'Not available'} </Text>
          {vehicleType ? (
            <Text style={styles.parenthesisText}>({vehicleType})</Text>
          ) : null}
        </Text>

        {/* Dispatch Bay */}
        <Text style={styles.infoLine}>
          <Text style={styles.boldLabel}>Dispatch Bay: </Text>
          <Text style={styles.valueText}>{dispatchBay || 'Not available'}</Text>
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  tripIdText: {
    fontSize: 19,
    fontWeight: '800',
    color: '#0066B3',
    letterSpacing: -0.2,
  },
  statusBadge: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16A34A',
    letterSpacing: 0.3,
  },
  infoList: {
    gap: 8,
  },
  infoLine: {
    fontSize: 13.5,
    lineHeight: 20,
    color: '#374151',
  },
  boldLabel: {
    fontWeight: '700',
    color: '#172033',
  },
  valueText: {
    color: '#374151',
    fontWeight: '400',
  },
  parenthesisText: {
    color: '#6B7280',
    fontWeight: '400',
  },
});

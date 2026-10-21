import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TripHistoryItem } from '../../types/tripHistory';

interface TripHistoryCardProps {
  item: TripHistoryItem;
  onViewDetails?: (trip: TripHistoryItem) => void;
  onReceiptPdf?: (trip: TripHistoryItem) => void;
}

/**
 * Trip History Card matching the exact visual references from the screenshots:
 * - Top row: Fuji Blue trip ID + Status badge (IN TRANSIT / DELIVERED)
 * - Middle: Bold destination title + detail bullet line (Date, Qty & Panels, Yard/Time)
 * - Divider line
 * - Bottom row: Left indicator (EWB code or ✓ POD Signed) + Right blue action button (View Details → / Receipt PDF ↓)
 */
export const TripHistoryCard: React.FC<TripHistoryCardProps> = ({
  item,
  onViewDetails,
  onReceiptPdf,
}) => {
  const isInTransit = item.status === 'IN TRANSIT';

  const handleActionPress = () => {
    if (item.actionType === 'viewDetails') {
      onViewDetails?.(item);
    } else {
      onReceiptPdf?.(item);
    }
  };

  return (
    <View style={styles.card}>
      {/* Top Row: Trip ID & Status Badge */}
      <View style={styles.topRow}>
        <Text style={styles.tripIdText}>{item.tripIdFormatted}</Text>
        <View
          style={[
            styles.statusBadge,
            isInTransit ? styles.statusBadgeInTransit : styles.statusBadgeDelivered,
          ]}
        >
          <Text
            style={[
              styles.statusBadgeText,
              isInTransit ? styles.statusTextInTransit : styles.statusTextDelivered,
            ]}
          >
            {item.status}
          </Text>
        </View>
      </View>

      {/* Destination Name */}
      <Text style={styles.destinationText}>{item.destination}</Text>

      {/* Trip Details Info */}
      <Text style={styles.infoText}>{item.tripInfo}</Text>

      {/* Horizontal Divider */}
      <View style={styles.divider} />

      {/* Bottom Row */}
      <View style={styles.bottomRow}>
        {/* Left Status / EWB */}
        {item.bottomLeftLabel ? (
          <Text
            style={[
              styles.bottomLeftText,
              item.bottomLeftType === 'ewb' ? styles.ewbColor : styles.podColor,
            ]}
          >
            {item.bottomLeftLabel}
          </Text>
        ) : (
          <View />
        )}

        {/* Right Action Button */}
        <Pressable
          onPress={handleActionPress}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={item.actionLabel}
          style={({ pressed }) => [pressed && styles.actionPressed]}
        >
          <Text style={styles.actionText}>{item.actionLabel}</Text>
        </Pressable>
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
    marginBottom: 12,
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
  },
  tripIdText: {
    fontSize: 16.5,
    fontWeight: '800',
    color: '#0066B3',
    letterSpacing: -0.2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeInTransit: {
    backgroundColor: '#FEF3C7',
  },
  statusBadgeDelivered: {
    backgroundColor: '#DCFCE7',
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  statusTextInTransit: {
    color: '#D97706',
  },
  statusTextDelivered: {
    color: '#16A34A',
  },
  destinationText: {
    fontSize: 15.5,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 6,
    letterSpacing: -0.2,
  },
  infoText: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 4,
    lineHeight: 18,
  },
  divider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginTop: 14,
    marginBottom: 12,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bottomLeftText: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  ewbColor: {
    color: '#0D9488',
  },
  podColor: {
    color: '#16A34A',
  },
  actionText: {
    color: '#0066B3',
    fontSize: 13.5,
    fontWeight: '700',
  },
  actionPressed: {
    opacity: 0.7,
  },
});

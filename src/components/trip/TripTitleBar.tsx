import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface TripTitleBarProps {
  title?: string;
  tripId?: string;
  subtitle?: string;
  categoryBadge?: string;
  onBack?: () => void;
}

/**
 * Page Title Section matching the design reference:
 * - Back button: "<"
 * - Title: "Trip Details & Manifest" / "Trip History & Logs"
 * - Subtitle: "#TRIP-FS-2026-941" / "Completed Logistics Runs"
 * - Right side: Blue/light-blue pill "LOGISTICS"
 */
export const TripTitleBar: React.FC<TripTitleBarProps> = ({
  title = 'Trip Details & Manifest',
  tripId,
  subtitle,
  categoryBadge = 'LOGISTICS',
  onBack,
}) => {
  const displaySubtitle = subtitle || tripId;

  return (
    <View style={styles.container}>
      {/* Back button (left out when the page header already has "< Back to …") */}
      {onBack ? (
      <Pressable
        onPress={onBack}
        style={({ pressed }) => [styles.backButton, pressed && styles.pressedState]}
        accessibilityRole="button"
        accessibilityLabel="Go Back"
        hitSlop={8}
      >
        <Ionicons name="chevron-back" size={20} color="#0B5FA8" />
      </Pressable>
      ) : null}

      {/* Title & Subtitle */}
      <View style={styles.titleColumn}>
        <Text style={styles.titleText} numberOfLines={1}>
          {title}
        </Text>
        {displaySubtitle ? (
          <Text style={styles.subtitleText} numberOfLines={1}>
            {displaySubtitle}
          </Text>
        ) : null}
      </View>

      {/* Right side Category Badge */}
      <View style={styles.badgeContainer}>
        <Text style={styles.badgeText}>{categoryBadge}</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginTop: -6,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  backButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  titleColumn: {
    flex: 1,
    justifyContent: 'center',
  },
  titleText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#172033',
    letterSpacing: -0.2,
  },
  subtitleText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#6B7280',
    marginTop: 2,
  },
  badgeContainer: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    alignSelf: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#0066B3',
    letterSpacing: 0.4,
  },
  pressedState: {
    opacity: 0.85,
    transform: [{ scale: 0.94 }],
    backgroundColor: '#F8FAFC',
  },
});

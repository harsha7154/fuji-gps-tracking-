import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { TripHistoryFilter } from '../../types/tripHistory';

interface TripFilterTabsProps {
  activeFilter: TripHistoryFilter;
  onFilterChange: (filter: TripHistoryFilter) => void;
  allCount: number;
  deliveredCount: number;
  inTransitCount: number;
}

export const TripFilterTabs: React.FC<TripFilterTabsProps> = ({
  activeFilter,
  onFilterChange,
  allCount,
  deliveredCount,
  inTransitCount,
}) => {
  const tabs: { key: TripHistoryFilter; label: string; count: number }[] = [
    { key: 'ALL', label: 'All Trips', count: allCount },
    { key: 'DELIVERED', label: 'Delivered', count: deliveredCount },
    { key: 'IN_TRANSIT', label: 'In Transit', count: inTransitCount },
  ];

  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const isActive = activeFilter === tab.key;

        return (
          <Pressable
            key={tab.key}
            onPress={() => onFilterChange(tab.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${tab.label} (${tab.count})`}
            style={({ pressed }) => [
              styles.tabPill,
              isActive ? styles.tabPillActive : styles.tabPillInactive,
              pressed && styles.tabPressed,
            ]}
          >
            <Text
              style={[
                styles.tabText,
                isActive ? styles.tabTextActive : styles.tabTextInactive,
              ]}
              numberOfLines={1}
            >
              {tab.label} ({tab.count})
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    gap: 8,
  },
  tabPill: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabPillActive: {
    backgroundColor: '#0066B3',
  },
  tabPillInactive: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tabText: {
    fontSize: 13,
    letterSpacing: -0.1,
  },
  tabTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  tabTextInactive: {
    color: '#334155',
    fontWeight: '600',
  },
  tabPressed: {
    opacity: 0.8,
  },
});

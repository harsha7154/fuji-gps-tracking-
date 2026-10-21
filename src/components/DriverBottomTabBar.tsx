import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../theme';

export type DriverBottomTabKey = 'dashboard' | 'myTrip' | 'liveGps' | 'history' | 'profile';

interface TabDefinition {
  key: DriverBottomTabKey;
  label: string;
  activeIcon: keyof typeof Ionicons.glyphMap;
  inactiveIcon: keyof typeof Ionicons.glyphMap;
}

const TABS: TabDefinition[] = [
  { key: 'dashboard', label: 'Dashboard', activeIcon: 'home', inactiveIcon: 'home-outline' },
  { key: 'myTrip', label: 'My Trip', activeIcon: 'document-text', inactiveIcon: 'document-text-outline' },
  { key: 'liveGps', label: 'Live GPS', activeIcon: 'compass', inactiveIcon: 'compass-outline' },
  { key: 'history', label: 'History', activeIcon: 'time', inactiveIcon: 'time-outline' },
  { key: 'profile', label: 'Profile', activeIcon: 'person', inactiveIcon: 'person-outline' },
];

interface DriverBottomTabBarProps {
  activeTab: DriverBottomTabKey;
  onTabPress: (tab: DriverBottomTabKey) => void;
}

/**
 * Fixed bottom tab bar for the Truck Driver dashboard:
 * Dashboard / My Trip / Live GPS / History / Profile.
 * Only "Dashboard" routes anywhere today — the rest call onTabPress so the
 * caller can wire real navigation once those screens exist (mirrors how
 * BottomTabBar handles unimplemented Site Engineer tabs).
 */
export const DriverBottomTabBar: React.FC<DriverBottomTabBarProps> = ({
  activeTab,
  onTabPress,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, spacing.xs) }]}>
      {TABS.map((tab) => {
        const isActive = tab.key === activeTab;

        return (
          <Pressable
            key={tab.key}
            onPress={() => onTabPress(tab.key)}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            style={styles.tab}
            hitSlop={4}
          >
            <Ionicons
              name={isActive ? tab.activeIcon : tab.inactiveIcon}
              size={22}
              color={isActive ? colors.primary : colors.tabInactive}
            />
            <Text style={[styles.label, isActive && styles.labelActive]} numberOfLines={1}>
              {tab.label}
            </Text>
            {isActive ? <View style={styles.activeIndicator} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderTopWidth: 1,
    borderTopColor: colors.cardBorder,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.xxs,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
  },
  label: {
    ...typography.caption,
    fontSize: 11,
    color: colors.tabInactive,
    marginTop: spacing.xxs,
  },
  labelActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  activeIndicator: {
    marginTop: 4,
    width: 20,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.primary,
  },
});

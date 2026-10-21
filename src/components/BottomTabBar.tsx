import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../theme';

export type BottomTabKey = 'home' | 'sites' | 'activities' | 'notifications' | 'more';

interface TabDefinition {
  key: BottomTabKey;
  label: string;
  activeIcon: keyof typeof Ionicons.glyphMap;
  inactiveIcon: keyof typeof Ionicons.glyphMap;
}

const TABS: TabDefinition[] = [
  { key: 'home', label: 'Home', activeIcon: 'home', inactiveIcon: 'home-outline' },
  { key: 'sites', label: 'Sites', activeIcon: 'location', inactiveIcon: 'location-outline' },
  {
    key: 'activities',
    label: 'Activities',
    activeIcon: 'clipboard',
    inactiveIcon: 'clipboard-outline',
  },
  {
    key: 'notifications',
    label: 'Notifications',
    activeIcon: 'notifications',
    inactiveIcon: 'notifications-outline',
  },
  { key: 'more', label: 'More', activeIcon: 'menu', inactiveIcon: 'menu-outline' },
];

interface BottomTabBarProps {
  activeTab: BottomTabKey;
  notificationCount?: number;
  onTabPress: (tab: BottomTabKey) => void;
}

/**
 * Fixed bottom tab bar: Home / Sites / Activities / Notifications / More.
 * Only "Home" routes anywhere today — the rest call onTabPress so the
 * caller can wire real navigation once those screens exist.
 */
export const BottomTabBar: React.FC<BottomTabBarProps> = ({
  activeTab,
  notificationCount = 0,
  onTabPress,
}) => {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, spacing.xs) }]}>
      {TABS.map((tab) => {
        const isActive = tab.key === activeTab;
        const showBadge = tab.key === 'notifications' && notificationCount > 0;

        return (
          <Pressable
            key={tab.key}
            onPress={() => onTabPress(tab.key)}
            accessibilityRole="button"
            accessibilityLabel={tab.label}
            style={styles.tab}
            hitSlop={4}
          >
            <View style={styles.iconWrapper}>
              <Ionicons
                name={isActive ? tab.activeIcon : tab.inactiveIcon}
                size={22}
                color={isActive ? colors.primary : colors.tabInactive}
              />
              {showBadge ? (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>
                    {notificationCount > 9 ? '9+' : notificationCount}
                  </Text>
                </View>
              ) : null}
            </View>
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
  iconWrapper: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.white,
    fontSize: 9,
    fontWeight: '700',
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

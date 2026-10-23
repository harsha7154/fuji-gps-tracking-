import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius } from '../theme';

interface HeaderIconButtonProps {
  icon?: keyof typeof Ionicons.glyphMap;
  iconColor?: string;
  backgroundColor?: string;
  badgeCount?: number;
  badgeColor?: string;
  size?: number;
  label?: string;
  labelColor?: string;
  /** Stronger shadow, for buttons drawn on a photo. */
  elevated?: boolean;
  onPress: () => void;
  accessibilityLabel: string;
}

/**
 * Circular header icon button used for the notification bell and the
 * avatar in the dashboard header. Supports an optional numeric badge.
 */
export const HeaderIconButton: React.FC<HeaderIconButtonProps> = ({
  icon,
  iconColor = colors.primary,
  backgroundColor = colors.white,
  badgeCount = 0,
  badgeColor,
  size = 40,
  label,
  labelColor,
  elevated = false,
  onPress,
  accessibilityLabel,
}) => {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={({ pressed }) => [
        styles.circle,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor,
          opacity: pressed ? 0.85 : 1,
        },
        elevated && styles.elevated,
      ]}
    >
      {label ? (
        <Text style={[styles.labelText, { color: labelColor ?? iconColor }]}>{label}</Text>
      ) : icon ? (
        <Ionicons name={icon} size={Math.round(size * 0.5)} color={iconColor} />
      ) : null}
      {badgeCount > 0 ? (
        <View style={[styles.badge, badgeColor ? { backgroundColor: badgeColor } : null]}>
          <Text style={styles.badgeText}>{badgeCount > 9 ? '9+' : badgeCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  circle: {
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.black,
    shadowOpacity: 0.08,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  elevated: {
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 5,
  },
  labelText: {
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: radius.pill,
    paddingHorizontal: 3,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.white,
  },
  badgeText: {
    color: colors.white,
    fontSize: 10,
    fontWeight: '700',
  },
});

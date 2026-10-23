import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, spacing, typography } from '../theme';

type IoniconName = keyof typeof Ionicons.glyphMap;
type MaterialCommunityIconName = keyof typeof MaterialCommunityIcons.glyphMap;

interface QuickActionCardProps {
  iconFamily?: 'ionicons' | 'material-community';
  icon: IoniconName | MaterialCommunityIconName;
  label: string;
  onPress: () => void;
}

/**
 * A single "Quick Actions" tile: outlined icon on top, label below.
 * Used in a 3-column grid on the dashboard.
 */
export const QuickActionCard: React.FC<QuickActionCardProps> = ({
  iconFamily = 'ionicons',
  icon,
  label,
  onPress,
}) => {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
    >
      <View style={styles.iconWrapper}>
        {iconFamily === 'material-community' ? (
          <MaterialCommunityIcons
            name={icon as MaterialCommunityIconName}
            size={26}
            color={colors.primary}
          />
        ) : (
          <Ionicons name={icon as IoniconName} size={26} color={colors.primary} />
        )}
      </View>
      <Text style={styles.label} numberOfLines={2}>
        {label}
      </Text>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  card: {
    flexBasis: '30%',
    flexGrow: 1,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardPressed: {
    backgroundColor: colors.concreteLighter,
  },
  iconWrapper: {
    marginBottom: spacing.sm,
  },
  label: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    textAlign: 'center',
  },
});
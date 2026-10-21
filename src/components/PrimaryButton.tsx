import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, ViewStyle } from 'react-native';
import { colors, radius, touchTarget, typography } from '../theme';

interface PrimaryButtonProps {
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  hasError?: boolean;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

/**
 * Full-width primary CTA. Supports default, pressed, loading, disabled,
 * and error visual states as required by the login flow.
 */
export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  label,
  onPress,
  loading = false,
  disabled = false,
  hasError = false,
  style,
  accessibilityLabel,
}) => {
  const isInteractionDisabled = disabled || loading;

  return (
    <Pressable
      onPress={onPress}
      disabled={isInteractionDisabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isInteractionDisabled, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        hasError && styles.error,
        disabled && !hasError && styles.disabled,
        pressed && !isInteractionDisabled && styles.pressed,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors.white} size="small" />
      ) : (
        <Text style={styles.label}>{label}</Text>
      )}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  base: {
    minHeight: touchTarget.minHeight + 8,
    borderRadius: radius.md,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  pressed: {
    backgroundColor: colors.primaryDark,
  },
  disabled: {
    backgroundColor: colors.disabled,
  },
  error: {
    backgroundColor: colors.error,
  },
  label: {
    ...typography.button,
    color: colors.white,
  },
});

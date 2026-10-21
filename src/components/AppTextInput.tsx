import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing, touchTarget, typography } from '../theme';

interface AppTextInputProps extends TextInputProps {
  icon: keyof typeof Ionicons.glyphMap;
  errorMessage?: string;
}

/**
 * Standard text input used across the login form: leading icon,
 * rounded border, white background, and a clear focus state.
 */
export const AppTextInput: React.FC<AppTextInputProps> = ({
  icon,
  errorMessage,
  onFocus,
  onBlur,
  style,
  ...rest
}) => {
  const [isFocused, setIsFocused] = useState(false);
  const hasError = Boolean(errorMessage);

  return (
    <View style={styles.wrapper}>
      <View
        style={[
          styles.container,
          isFocused && styles.containerFocused,
          hasError && styles.containerError,
        ]}
      >
        <Ionicons
          name={icon}
          size={20}
          color={hasError ? colors.error : isFocused ? colors.primary : colors.mediumGray}
          style={styles.icon}
        />
        <TextInput
          style={[styles.input, style]}
          placeholderTextColor={colors.textPlaceholder}
          autoCapitalize="none"
          autoCorrect={false}
          onFocus={(e) => {
            setIsFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setIsFocused(false);
            onBlur?.(e);
          }}
          {...rest}
        />
      </View>
      {hasError ? (
        <Text style={styles.errorText} accessibilityRole="alert">
          {errorMessage}
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touchTarget.minHeight + 8,
    borderWidth: 1,
    borderColor: colors.borderGray,
    borderRadius: radius.md,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
  },
  containerFocused: {
    borderColor: colors.primary,
    borderWidth: 1.5,
  },
  containerError: {
    borderColor: colors.error,
  },
  icon: {
    marginRight: spacing.sm,
  },
  input: {
    flex: 1,
    fontSize: typography.body.fontSize,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  errorText: {
    ...typography.caption,
    color: colors.error,
    marginTop: spacing.xxs,
    marginLeft: spacing.xxs,
  },
});

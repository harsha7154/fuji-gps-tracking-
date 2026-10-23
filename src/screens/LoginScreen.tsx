import React, { useCallback, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import {
  AuthBottomBand,
  AuthSubmitButton,
  AuthTopBand,
} from '../components/auth/AuthLayout';
import type { UserRole } from '../types/auth';
import { ROLE_LABELS } from '../types/auth';
import { colors, spacing, typography } from '../theme';

interface FormErrors {
  phoneNumber?: string;
  formError?: string;
}

interface LoginScreenProps {
  /**
   * Optional pre-selected role.
   */
  role?: UserRole;

  /**
   * Back to the role picker.
   */
  onBack?: () => void;

  /**
   * Callback for sending OTP to phone number.
   */
  onSendOtp?: (phoneNumber: string) => void | Promise<void>;
}

function validate(phoneNumber: string): FormErrors {
  const errors: FormErrors = {};

  const trimmedPhone = phoneNumber.trim();

  if (!trimmedPhone) {
    errors.phoneNumber = 'Phone number is required.';
    return errors;
  }

  // Accepts Indian 10-digit numbers for now.
  const digitsOnly = trimmedPhone.replace(/\D/g, '');

  if (digitsOnly.length !== 10) {
    errors.phoneNumber = 'Please enter a valid 10-digit phone number.';
  }

  return errors;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ role, onBack, onSendOtp }) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const { height: windowHeight } = useWindowDimensions();

  const isCompact = windowHeight < 720;

  const handleSendOtp = useCallback(async () => {
    if (isSubmitting) return;

    const validationErrors = validate(phoneNumber);

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);

    try {
      console.log('[LoginScreen] Send OTP requested for:', phoneNumber);

      if (onSendOtp) {
        await onSendOtp(phoneNumber);
      }
    } catch (error) {
      console.warn('[LoginScreen] Send OTP error:', error);
      const rawMsg = error instanceof Error ? error.message : '';
      const isRateLimited = rawMsg.includes('429') || rawMsg.toLowerCase().includes('too many');

      setErrors({
        formError: isRateLimited
          ? 'Too many OTP requests (429 Too Many Requests). Please wait a few minutes before trying again.'
          : rawMsg || 'Something went wrong. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [phoneNumber, isSubmitting, onSendOtp]);

  const handleChangePhone = useCallback(
    (text: string) => {
      // Numbers only, maximum 10 digits.
      setPhoneNumber(text.replace(/\D/g, '').slice(0, 10));

      if (errors.phoneNumber || errors.formError) {
        setErrors({});
      }
    },
    [errors.phoneNumber, errors.formError],
  );

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Top band with concrete pattern, curved blue line, and Fuji Silvertech logo */}
          <View style={styles.topContainer}>
            <AuthTopBand />
          </View>

          {/* Form Content Area */}
          <View style={[styles.content, isCompact && styles.contentCompact]}>
            {role ? (
              <Pressable
                onPress={onBack}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Change role"
                style={styles.roleBanner}
              >
                <Ionicons name="chevron-back" size={16} color={colors.primary} />
                <Text style={styles.roleBannerText}>
                  Logging in as <Text style={styles.roleBannerRole}>{ROLE_LABELS[role]}</Text>
                </Text>
              </Pressable>
            ) : null}

            <Text style={[styles.heading, isCompact && styles.headingCompact]}>
              Welcome <Text style={styles.headingAccent}>Back!</Text>
            </Text>
            <Text style={[styles.subheading, isCompact && styles.subheadingCompact]}>
              Enter your mobile number to continue
            </Text>

            {/* High-visibility Phone Card */}
            <View
              style={[
                styles.phoneCard,
                isFocused && styles.phoneCardFocused,
                Boolean(errors.phoneNumber) && styles.phoneCardError,
              ]}
            >
              <View style={[styles.phoneIconCircle, isFocused && styles.phoneIconCircleFocused]}>
                <Ionicons
                  name="call"
                  size={19}
                  color={isFocused ? colors.primary : colors.textSecondary}
                />
              </View>

              <View style={styles.divider} />

              <View style={styles.countryCode} accessibilityLabel="Country code India plus 91">
                
                <Text style={styles.countryCodeText}>+91</Text>
              </View>

              <View style={styles.divider} />

              <TextInput
                style={styles.phoneInput}
                placeholder="Mobile Number"
                placeholderTextColor={colors.textPlaceholder}
                value={phoneNumber}
                onChangeText={handleChangePhone}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
                returnKeyType="done"
                maxLength={10}
                onSubmitEditing={handleSendOtp}
                accessibilityLabel="Mobile number"
              />

              {phoneNumber.length > 0 ? (
                <Pressable
                  onPress={() => {
                    setPhoneNumber('');
                    setErrors({});
                  }}
                  hitSlop={8}
                  style={styles.clearButton}
                  accessibilityRole="button"
                  accessibilityLabel="Clear phone number"
                >
                  <Ionicons name="close-circle" size={20} color="#94A3B8" />
                </Pressable>
              ) : null}
            </View>

            {errors.phoneNumber ? (
              <View style={styles.fieldErrorRow}>
                <Ionicons name="alert-circle" size={15} color={colors.error} />
                <Text style={styles.fieldError}>{errors.phoneNumber}</Text>
              </View>
            ) : null}

            {errors.formError ? (
              <View style={styles.formErrorBanner}>
                <Ionicons name="alert-circle" size={18} color={colors.error} style={{ marginRight: 6 }} />
                <Text style={styles.formErrorText}>{errors.formError}</Text>
              </View>
            ) : null}

            <AuthSubmitButton
              label="Send OTP"
              onPress={handleSendOtp}
              loading={isSubmitting}
              style={[styles.submitButton, isCompact && styles.submitButtonCompact]}
            />
          </View>

          {/* Bottom Skyline Band */}
          <View style={styles.bottomContainer} pointerEvents="none">
            <AuthBottomBand />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'space-between',
    minHeight: '100%',
  },
  topContainer: {
    width: '100%',
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginTop: -spacing.md,
    zIndex: 3,
  },
  contentCompact: {
    paddingVertical: spacing.xs,
    marginTop: -spacing.lg,
  },

  roleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(11, 95, 168, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(11, 95, 168, 0.16)',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    marginBottom: spacing.md,
    gap: 4,
  },
  roleBannerText: {
    fontSize: 13,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  roleBannerRole: {
    color: colors.primary,
    fontWeight: '700',
  },

  heading: {
    fontSize: 32,
    fontWeight: '900',
    color: colors.charcoal,
    letterSpacing: 0.5,
  },
  headingCompact: {
    fontSize: 26,
  },
  headingAccent: {
    color: colors.primary,
    fontWeight: '900',
  },
  subheading: {
    fontSize: 15,
    color: colors.textSecondary,
    marginTop: 4,
    marginBottom: spacing.lg,
  },
  subheadingCompact: {
    fontSize: 13.5,
    marginTop: 2,
    marginBottom: spacing.md,
  },

  phoneCard: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 58,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    backgroundColor: colors.white,
    paddingHorizontal: 14,
    shadowColor: '#1F3B66',
    shadowOpacity: 0.07,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  phoneCardFocused: {
    borderColor: colors.primary,
    shadowColor: colors.primary,
    shadowOpacity: 0.18,
    shadowRadius: 12,
    elevation: 5,
  },
  phoneCardError: {
    borderColor: colors.error,
    backgroundColor: '#FFFBFB',
  },
  phoneIconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneIconCircleFocused: {
    backgroundColor: 'rgba(11, 95, 168, 0.1)',
  },
  divider: {
    width: 1,
    height: 28,
    backgroundColor: '#E2E8F0',
    marginHorizontal: 10,
  },
  countryCode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  countryFlag: {
    fontSize: 16,
  },
  countryCodeText: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.charcoal,
  },
  phoneInput: {
    flex: 1,
    height: '100%',
    fontSize: 17,
    fontWeight: '600',
    color: colors.charcoal,
    letterSpacing: 1.2,
    paddingVertical: 0,
  },
  clearButton: {
    padding: 4,
    marginLeft: 6,
  },
  fieldErrorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
    gap: 6,
  },
  fieldError: {
    ...typography.bodySmall,
    color: colors.error,
    fontSize: 12.5,
    fontWeight: '600',
  },

  formErrorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.errorBackground,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
  },
  formErrorText: {
    ...typography.bodySmall,
    color: colors.error,
    flex: 1,
    fontSize: 13,
  },

  submitButton: {
    marginTop: spacing.xl,
  },
  submitButtonCompact: {
    marginTop: spacing.md,
  },

  bottomContainer: {
    width: '100%',
  },
});


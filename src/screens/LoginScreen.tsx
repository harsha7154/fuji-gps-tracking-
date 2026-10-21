import React, { useCallback, useState } from 'react';
import {
  ImageBackground,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppHeader } from '../components/AppHeader';
import { AppTextInput } from '../components/AppTextInput';
import { PrimaryButton } from '../components/PrimaryButton';
import { Ionicons } from '@expo/vector-icons';
import type { UserRole } from '../types/auth';
import { ROLE_LABELS } from '../types/auth';
import { colors, spacing, typography } from '../theme';

const FOOTER_STRIP = require('../../assets/images/footer-strip1.png');

const FOOTER_ASPECT_RATIO = 1933 / 814;

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
  // Backend validation will be handled when OTP API is integrated.
  const digitsOnly = trimmedPhone.replace(/\D/g, '');

  if (digitsOnly.length !== 10) {
    errors.phoneNumber = 'Please enter a valid 10-digit phone number.';
  }

  return errors;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({
  role,
  onBack,
  onSendOtp,
}) => {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [errors, setErrors] = useState<FormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      console.log(
        '[LoginScreen] Send OTP requested for:',
        phoneNumber
      );

      if (onSendOtp) {
        await onSendOtp(phoneNumber);
      }
    } catch (error) {
      console.warn(
        '[LoginScreen] Send OTP error:',
        error
      );

      setErrors({
        formError:
          error instanceof Error
            ? error.message
            : 'Something went wrong. Please try again.',
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [phoneNumber, isSubmitting, onSendOtp]);

  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const footerHeight =
    screenWidth / FOOTER_ASPECT_RATIO;

  return (
    <View style={styles.root}>
      <AppHeader
        variant="logoOnly"
        logoWidth={Math.min(screenWidth * 0.46, 220)}
      />

      {role ? (
        <Pressable
          onPress={onBack}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Change role"
          style={styles.roleBanner}
        >
          <Ionicons
            name="chevron-back"
            size={18}
            color={colors.primary}
          />

          <Text style={styles.roleBannerText}>
            Logging in as{' '}
            <Text style={styles.roleBannerRole}>
              {ROLE_LABELS[role]}
            </Text>
          </Text>
        </Pressable>
      ) : null}

      <KeyboardAvoidingView
        style={styles.middle}
        behavior={
          Platform.OS === 'ios'
            ? 'padding'
            : 'height'
        }
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.content}>
            <Text style={styles.heading}>
              Welcome Back!
            </Text>

            <Text style={styles.subheading}>
              Enter your phone number to continue
            </Text>

            <View style={styles.form}>
              {/* Phone Number */}

              <AppTextInput
                icon="call-outline"
                placeholder="Phone Number"
                value={phoneNumber}
                onChangeText={(text) => {
                  // Keep only numbers.
                  const digitsOnly = text.replace(
                    /\D/g,
                    ''
                  );

                  // Maximum 10 digits for now.
                  const limitedNumber =
                    digitsOnly.slice(0, 10);

                  setPhoneNumber(limitedNumber);

                  if (errors.phoneNumber) {
                    setErrors((e) => ({
                      ...e,
                      phoneNumber: undefined,
                    }));
                  }

                  if (errors.formError) {
                    setErrors((e) => ({
                      ...e,
                      formError: undefined,
                    }));
                  }
                }}
                errorMessage={errors.phoneNumber}
                keyboardType="phone-pad"
                textContentType="telephoneNumber"
                autoComplete="tel"
                returnKeyType="done"
                onSubmitEditing={handleSendOtp}
              />

              {/* Form Error */}

              {errors.formError ? (
                <View style={styles.formErrorBanner}>
                  <Text style={styles.formErrorText}>
                    {errors.formError}
                  </Text>
                </View>
              ) : null}

              {/* Send OTP Button */}

              <PrimaryButton
                label="Send OTP"
                onPress={handleSendOtp}
                loading={isSubmitting}
                hasError={Boolean(
                  errors.formError
                )}
                style={styles.loginButton}
              />

              {role ? (
                <Text style={styles.demoHint}>
                  {role}
                </Text>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ImageBackground
        source={FOOTER_STRIP}
        style={[
          styles.footer,
          {
            height: footerHeight,
          },
        ]}
        resizeMode="cover"
      >
        <View
          style={[
            styles.footerTextWrapper,
            {
              paddingBottom: Math.max(
                insets.bottom,
                spacing.sm
              ),
            },
          ]}
        >
          <Text style={styles.footerTitle}>
            FUJI SILVERTECH CONCRETE PVT. LTD.
          </Text>

          <Text style={styles.footerSubtitle}>
            The Future is Precast
          </Text>
        </View>
      </ImageBackground>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.white,
  },

  roleBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.sm,
  },

  roleBannerText: {
    ...typography.bodySmall,
    color: colors.textSecondary,
  },

  roleBannerRole: {
    color: colors.primary,
    fontWeight: '700',
  },

  middle: {
    flex: 1,
  },

  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },

  content: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },

  heading: {
    ...typography.h2,
    color: colors.textPrimary,
  },

  subheading: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.xxs,
    marginBottom: spacing.lg,
  },

  form: {
    width: '100%',
  },

  loginButton: {
    marginTop: spacing.lg,
    marginBottom: spacing.xs,
  },

  formErrorBanner: {
    backgroundColor: colors.errorBackground,
    borderRadius: 8,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },

  formErrorText: {
    ...typography.bodySmall,
    color: colors.error,
  },

  demoHint: {
    ...typography.caption,
    color: colors.textPlaceholder,
    textAlign: 'center',
    marginTop: spacing.md,
  },

  footer: {
    paddingBottom: 20,
    width: '100%',
    justifyContent: 'flex-end',
  },

  footerTextWrapper: {
    alignItems: 'center',
  },

  footerTitle: {
    ...typography.footer,
    color: colors.primary,
  },

  footerSubtitle: {
    ...typography.caption,
    color: colors.textPrimary,
    marginTop: 2,
  },
});
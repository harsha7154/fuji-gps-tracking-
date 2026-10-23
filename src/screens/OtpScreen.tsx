import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  AUTH_HERO_LOGIN,
  AuthBottomBand,
  AuthHero,
  AuthSubmitButton,
  AuthTopBand,
  useAuthScale,
} from '../components/auth/AuthLayout';
import LottieView from '../components/LottieView';
import { colors, spacing, typography } from '../theme';

const TRUCK_ONSITE_ANIMATION = require('../../assets/animations/truck-material-onsite.json');
const NO_INTERNET_ANIMATION = require('../../assets/animations/no-internet.json');

import { SPLASH_DURATION_MS } from './SplashScreen';

interface OtpScreenProps {
  phoneNumber: string;

  verificationToken?: string;

  /**
   * Called after OTP is locally validated.
   */
  onVerifyOtp?: (otp: string) => void | Promise<void>;

  /**
   * Return to phone number screen.
   */
  onChangePhone?: () => void;

  onResendOtp?: () => Promise<boolean>;
}

const OTP_LENGTH = 6;
const RESEND_AFTER_SECONDS = 60;

/** "9876543210" -> "+91 98765 43210" */
function formatPhone(phoneNumber: string): string {
  const digits = phoneNumber.replace(/^\+91\s*/, '').replace(/\D/g, '');
  return digits.length === 10 ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : `+91 ${digits}`;
}

/** 30 -> "00:30" */
function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export const OtpScreen: React.FC<OtpScreenProps> = ({
  phoneNumber,
  onVerifyOtp,
  onChangePhone,
  onResendOtp,
}) => {
  const [otp, setOtp] = useState('');
  const [secondsLeft, setSecondsLeft] = useState(RESEND_AFTER_SECONDS);
  const [statusState, setStatusState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [serverError, setServerError] = useState('');
  const [error, setError] = useState('');
  const [isResending, setIsResending] = useState(false);

  const isVerifying = statusState === 'loading';

  const insets = useSafeAreaInsets();
  const otpInputRef = useRef<TextInput>(null);
  const scale = useAuthScale();
  const { height: windowHeight } = useWindowDimensions();

  // Compact hero height so the screen fits comfortably on any device
  const heroDesignHeight = windowHeight < 700 ? 320 : windowHeight < 800 ? 400 : 480;

  const handleFocusInput = () => {
    if (!otpInputRef.current) return;
    // Blur first so Android resets its native focus state if the keyboard was closed,
    // then focus on the next tick so the soft keyboard is forced to open.
    otpInputRef.current.blur();
    setTimeout(() => {
      otpInputRef.current?.focus();
    }, 50);
  };

  // Focus the input when the screen opens.
  useEffect(() => {
    const timer = setTimeout(handleFocusInput, 150);
    return () => clearTimeout(timer);
  }, []);

  // Resend countdown.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const timer = setInterval(() => setSecondsLeft((current) => current - 1), 1000);
    return () => clearInterval(timer);
  }, [secondsLeft]);

  const executeVerify = useCallback(
    async (codeToVerify?: string) => {
      const targetOtp = (codeToVerify ?? otp).trim();
      if (statusState === 'loading') return;

      if (targetOtp.length !== OTP_LENGTH) {
        setError('Please enter the 6-digit OTP.');
        return;
      }

      setError('');
      setServerError('');
      Keyboard.dismiss();
      setStatusState('loading');

      // Keep the truck-material-onsite loader animation displayed for 5 seconds (same as splash screen)
      // so the user can interact and clearly see it on all mobile screens
      await new Promise((resolve) => setTimeout(resolve, SPLASH_DURATION_MS));

      try {
        if (onVerifyOtp) {
          await onVerifyOtp(targetOtp);
        }
      } catch (err) {
        console.warn('[OtpScreen] OTP verification error:', err);
        const rawMsg = err instanceof Error ? err.message : '';
        const isRateLimited = rawMsg.includes('429') || rawMsg.toLowerCase().includes('too many');

        const msg = isRateLimited
          ? 'You have reached the maximum attempt limit for OTP verification. Please wait a few minutes before trying again.'
          : rawMsg || 'Unable to connect to server. Please check your internet connection and try again.';

        setServerError(msg);
        setStatusState('error');
      }
    },
    [statusState, onVerifyOtp, otp]
  );

  const handleOtpChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setOtp(digits);
    if (error) setError('');

    // When 6 digits are reached, dismiss keyboard so user can click Verify OTP
    if (digits.length === OTP_LENGTH) {
      Keyboard.dismiss();
    }
  };

  const handleResendOtp = async () => {
    if (secondsLeft > 0 || isResending) return;

    setIsResending(true);
    setError('');

    try {
      const success = await onResendOtp?.();

      if (!success) {
        return;
      }

      // Clear the old OTP and start a fresh countdown only after the backend sent a new one.
      setOtp('');
      setSecondsLeft(RESEND_AFTER_SECONDS);
      handleFocusInput();
    } catch (err) {
      console.error('[OtpScreen] Resend OTP failed:', err);
      const rawMsg = err instanceof Error ? err.message : '';
      const isRateLimited = rawMsg.includes('429') || rawMsg.toLowerCase().includes('too many');
      setError(
        isRateLimited
          ? 'Too many requests (429). Please wait a few minutes before requesting a new OTP.'
          : rawMsg || 'Unable to resend OTP. Please try again.'
      );
    } finally {
      setIsResending(false);
    }
  };

  const canResend = secondsLeft <= 0 && !isResending;

  return (
    <View style={styles.root}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.screenLayout}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Top concrete band with logo */}
          <View style={styles.topContainer}>
            <AuthTopBand />
            <Pressable
              onPress={onChangePhone}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back, change phone number"
              style={[styles.backButton, { top: Math.max(insets.top, 16) + 6 }]}
            >
              <Ionicons name="arrow-back" size={18} color={colors.primary} />
              <Text style={styles.backText}>Back</Text>
            </Pressable>
          </View>

          {/* Centered OTP Form Area - Fixed on screen without scroll */}
          <View style={styles.content}>
            <Text style={styles.heading}>
              Verify <Text style={styles.headingAccent}>OTP</Text>
            </Text>
            <Text style={styles.subheading}>Enter the 6-digit OTP sent to</Text>

            <Pressable
              onPress={onChangePhone}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Edit phone number"
              style={styles.phoneBadge}
            >
              <Text style={styles.phoneNumber}>{formatPhone(phoneNumber)}</Text>
              <View style={styles.editIconBadge}>
                <Ionicons name="pencil" size={11} color={colors.primary} />
              </View>
            </Pressable>

            {/* 6 OTP boxes with hidden input */}
            <Pressable onPress={handleFocusInput} style={styles.otpInputWrapper}>
              <View style={styles.otpBoxes} pointerEvents="none">
                {Array.from({ length: OTP_LENGTH }).map((_, index) => {
                  const digit = otp[index];
                  const isActive = otp.length === index;
                  const isFilled = digit !== undefined;

                  return (
                    <View
                      key={index}
                      style={[
                        styles.otpBox,
                        isFilled && styles.otpBoxFilled,
                        isActive && styles.otpBoxActive,
                        Boolean(error) && styles.otpBoxError,
                      ]}
                    >
                      {isFilled ? (
                        <Text style={styles.otpDigit}>{digit}</Text>
                      ) : isActive ? (
                        <View style={styles.otpActiveCursor} />
                      ) : (
                        <View style={styles.otpDotPlaceholder} />
                      )}
                    </View>
                  );
                })}
              </View>

              <TextInput
                ref={otpInputRef}
                value={otp}
                onChangeText={handleOtpChange}
                keyboardType="number-pad"
                maxLength={OTP_LENGTH}
                style={styles.realOtpInput}
                textContentType="oneTimeCode"
                autoComplete="sms-otp"
                returnKeyType="done"
                onSubmitEditing={() => executeVerify(otp)}
                caretHidden
                accessibilityLabel="One-time password"
              />
            </Pressable>

            {/* Resend Section */}
            <View style={styles.resendContainer}>
              <Text style={styles.resendLabel}>Didn’t receive the code? </Text>
              {canResend ? (
                <Pressable
                  onPress={handleResendOtp}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Resend OTP code"
                  style={styles.resendButton}
                >
                  <Ionicons name="refresh" size={14} color={colors.primary} />
                  <Text style={styles.resendLink}>
                    {isResending ? 'Sending…' : 'Resend Code'}
                  </Text>
                </Pressable>
              ) : (
                <View style={styles.resendTimerBadge}>
                  <Ionicons name="time-outline" size={13} color={colors.textSecondary} />
                  <Text style={styles.resendTimerText}>
                    Resend in <Text style={styles.resendTimerCountdown}>{formatTimer(secondsLeft)}</Text>
                  </Text>
                </View>
              )}
            </View>

            {error ? (
              <View style={styles.errorContainer}>
                <Ionicons name="alert-circle" size={16} color={colors.error} />
                <Text style={styles.errorText}>{error}</Text>
              </View>
            ) : null}

            {/* Manual Verify Button */}
            <AuthSubmitButton
              label="Verify OTP"
              onPress={() => executeVerify(otp)}
              disabled={isVerifying}
              style={styles.verifyButton}
            />
          </View>

          {/* Bottom Skyline Band */}
          <View style={styles.bottomContainer} pointerEvents="none">
            <AuthBottomBand />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Full screen white background with truck-material-onsite animation centered */}
      {statusState === 'loading' ? (
        <View style={styles.fullWhiteOverlay} accessibilityRole="progressbar" accessibilityLabel="Verifying OTP">
          {LottieView ? (
            <LottieView
              source={TRUCK_ONSITE_ANIMATION}
              autoPlay
              loop
              resizeMode="contain"
              style={styles.onsiteTruckLottie}
            />
          ) : (
            <ActivityIndicator size="large" color={colors.primary} />
          )}
          <Text style={styles.loadingTitle}>Verifying OTP…</Text>
          <Text style={styles.loadingSubtitle}>Please wait a moment while we verify your account</Text>
        </View>
      ) : null}

      {/* Full screen white background with no-internet animation on server/network error */}
      {statusState === 'error' ? (
        <View style={styles.fullWhiteOverlay}>
          {LottieView ? (
            <LottieView
              source={NO_INTERNET_ANIMATION}
              autoPlay
              loop
              resizeMode="contain"
              style={styles.noInternetLottie}
            />
          ) : (
            <Ionicons name="cloud-offline-outline" size={68} color={colors.error} />
          )}
          <Text style={styles.errorScreenTitle}>
            {serverError.includes('429') || serverError.toLowerCase().includes('too many')
              ? 'Too Many Requests (429)'
              : 'Connection or Server Error'}
          </Text>
          <Text style={styles.errorScreenMessage}>
            {serverError || 'Unable to connect to the server. Please check your internet connection and try again.'}
          </Text>
          <View style={styles.errorActionsRow}>
            <Pressable
              onPress={() => executeVerify(otp)}
              hitSlop={10}
              style={styles.retryActionButton}
              accessibilityRole="button"
              accessibilityLabel="Retry Verification"
            >
              <Ionicons name="refresh" size={18} color={colors.white} />
              <Text style={styles.retryActionButtonText}>Retry Verification</Text>
            </Pressable>

            <Pressable
              onPress={() => {
                setStatusState('idle');
                handleFocusInput();
              }}
              hitSlop={10}
              style={styles.editOtpButton}
              accessibilityRole="button"
              accessibilityLabel="Edit OTP"
            >
              <Text style={styles.editOtpButtonText}>Edit OTP Code</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
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
  screenLayout: {
    flexGrow: 1,
    justifyContent: 'space-between',
    minHeight: '100%',
  },

  topContainer: {
    width: '100%',
  },

  backButton: {
    position: 'absolute',
    left: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderWidth: 1,
    borderColor: 'rgba(11, 95, 168, 0.12)',
    shadowColor: '#1F3B66',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  backText: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },

  content: {
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    zIndex: 3,
  },
  heading: {
    fontSize: 26,
    fontWeight: '900',
    color: colors.charcoal,
    textAlign: 'center',
    letterSpacing: 0.6,
  },
  headingAccent: {
    color: colors.primary,
    fontWeight: '900',
  },
  subheading: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  phoneBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.xs,
    marginBottom: spacing.md,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: 'rgba(11, 95, 168, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(11, 95, 168, 0.16)',
  },
  phoneNumber: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.charcoal,
    letterSpacing: 0.4,
  },
  editIconBadge: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.15,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },

  otpInputWrapper: {
    position: 'relative',
    width: '100%',
    height: 54,
  },
  otpBoxes: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 8,
    width: '100%',
    height: 54,
  },
  otpBox: {
    flex: 1,
    height: 54,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#D8DEE8',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1F3B66',
    shadowOpacity: 0.04,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  otpBoxFilled: {
    borderColor: colors.primary,
    backgroundColor: colors.white,
    shadowColor: colors.primary,
    shadowOpacity: 0.08,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  otpBoxActive: {
    borderColor: colors.primary,
    borderWidth: 2,
    backgroundColor: colors.white,
    shadowColor: colors.primary,
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  otpBoxError: {
    borderColor: colors.error,
    backgroundColor: '#FFF5F5',
  },
  otpDigit: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  otpDotPlaceholder: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: '#CBD5E1',
  },
  otpActiveCursor: {
    width: 2,
    height: 20,
    borderRadius: 1,
    backgroundColor: colors.primary,
  },
  realOtpInput: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    opacity: 0.01,
    color: 'transparent',
    backgroundColor: 'transparent',
  },

  resendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: spacing.md,
    gap: 6,
  },
  resendLabel: {
    fontSize: 13,
    color: colors.textSecondary,
  },
  resendButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  resendLink: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.primary,
  },
  resendTimerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  resendTimerText: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  resendTimerCountdown: {
    fontWeight: '700',
    color: colors.primary,
  },

  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.errorBackground,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(198, 40, 40, 0.2)',
    paddingVertical: 8,
    paddingHorizontal: spacing.sm,
    marginTop: spacing.xs,
    width: '100%',
  },
  errorText: {
    ...typography.bodySmall,
    color: colors.error,
    flex: 1,
    fontWeight: '500',
    fontSize: 12,
  },

  verifyButton: {
    width: '100%',
    marginTop: spacing.md,
    marginBottom: 0,
  },

  bottomContainer: {
    width: '100%',
  },

  fullWhiteOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    zIndex: 99999,
    elevation: 99999,
  },
  onsiteTruckLottie: {
    width: 250,
    height: 250,
  },
  noInternetLottie: {
    width: 200,
    height: 200,
  },
  loadingTitle: {
    fontSize: 19,
    fontWeight: '800',
    color: colors.charcoal,
    marginTop: spacing.md,
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  loadingSubtitle: {
    fontSize: 13.5,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: spacing.md,
  },
  errorScreenTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.charcoal,
    marginTop: spacing.md,
    textAlign: 'center',
    letterSpacing: 0.2,
  },
  errorScreenMessage: {
    fontSize: 14,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    lineHeight: 20,
    paddingHorizontal: spacing.md,
  },
  errorActionsRow: {
    width: '100%',
    alignItems: 'center',
    marginTop: spacing.xl,
    gap: 12,
  },
  retryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.primary,
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 16,
    shadowColor: colors.primary,
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    width: '100%',
  },
  retryActionButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  editOtpButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editOtpButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primary,
  },
});


import React, {
    useEffect,
    useRef,
    useState,
} from 'react';

import {
    ImageBackground,
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

import { AppHeader } from '../components/AppHeader';
import { PrimaryButton } from '../components/PrimaryButton';
import { colors, spacing, typography } from '../theme';

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

const FOOTER_STRIP = require('../../assets/images/footer-strip1.png');
const FOOTER_ASPECT_RATIO = 1933 / 814;

export const OtpScreen: React.FC<OtpScreenProps> = ({
    phoneNumber,
    verificationToken,
    onVerifyOtp,
    onChangePhone,
    onResendOtp,
}) => {
    const [otp, setOtp] = useState('');
    const [secondsLeft, setSecondsLeft] = useState(60);
    const [isVerifying, setIsVerifying] = useState(false);
    const [error, setError] = useState('');
    const [isResending, setIsResending] = useState(false);

    const otpInputRef = useRef<TextInput>(null);

    const insets = useSafeAreaInsets();
    const { width: screenWidth } = useWindowDimensions();
    const footerHeight = screenWidth / FOOTER_ASPECT_RATIO;

    const handleFocusInput = () => {
        if (!otpInputRef.current) return;
        // Blur first so Android resets its native focus state if keyboard was closed,
        // then focus on the next tick so the soft keyboard is forced to open.
        otpInputRef.current.blur();
        setTimeout(() => {
            otpInputRef.current?.focus();
        }, 50);
    };

    /*
     * Automatically focus the input when the screen mounts.
     */
    useEffect(() => {
        const timer = setTimeout(() => {
            handleFocusInput();
        }, 150);
        return () => clearTimeout(timer);
    }, []);

    /*
     * --------------------------------------------------
     * OTP COUNTDOWN
     * --------------------------------------------------
     */

    useEffect(() => {
        if (secondsLeft <= 0) {
            return;
        }

        const timer = setInterval(() => {
            setSecondsLeft((current) => current - 1);
        }, 1000);

        return () => clearInterval(timer);
    }, [secondsLeft]);

    /*
     * --------------------------------------------------
     * OTP INPUT
     * --------------------------------------------------
     */

    const handleOtpChange = (text: string) => {
        // Allow numbers only.
        const digitsOnly = text.replace(/\D/g, '');

        // Maximum 6 digits.
        const limitedOtp = digitsOnly.slice(0, 6);

        setOtp(limitedOtp);

        if (error) {
            setError('');
        }
    };

    /*
     * --------------------------------------------------
     * VERIFY OTP
     * --------------------------------------------------
     *
     * Backend integration will be added later.
     */

    const handleVerifyOtp = async () => {
        if (isVerifying) {
            return;
        }

        if (otp.length !== 6) {
            setError('Please enter the 6-digit OTP.');
            return;
        }

        setError('');
        setIsVerifying(true);

        try {
            console.log(
                '[OtpScreen] Phone:',
                phoneNumber
            );

            console.log(
                '[OtpScreen] OTP:',
                otp
            );

            if (onVerifyOtp) {
                await onVerifyOtp(otp);
            }
        } catch (err) {
            console.warn(
                '[OtpScreen] OTP verification error:',
                err
            );

            setError(
                err instanceof Error
                    ? err.message
                    : 'Unable to verify OTP. Please try again.'
            );
        } finally {
            setIsVerifying(false);
        }
    };

    /*
     * --------------------------------------------------
     * RESEND OTP
     * --------------------------------------------------
     *
     * Backend resend API will be connected later.
     */

    const handleResendOtp = async () => {
        if (secondsLeft > 0 || isResending) {
            return;
        }

        console.log(
            '[OtpScreen] Requesting new OTP:',
            phoneNumber
        );

        setIsResending(true);
        setError('');

        try {
            const success = await onResendOtp?.();

            if (!success) {
                setError(
                    'Unable to resend OTP. Please try again.'
                );
                return;
            }

            // Clear the old OTP.
            setOtp('');

            // Start a fresh countdown only after
            // the backend successfully sends the OTP.
            setSecondsLeft(60);

            console.log(
                '[OtpScreen] New OTP sent successfully.'
            );
        } catch (error) {
            console.error(
                '[OtpScreen] Resend OTP failed:',
                error
            );

            setError(
                error instanceof Error
                    ? error.message
                    : 'Unable to resend OTP. Please try again.'
            );
        } finally {
            setIsResending(false);
        }
    };

    /*
     * --------------------------------------------------
     * MASK PHONE NUMBER
     * --------------------------------------------------
     */

    const cleanPhone = phoneNumber.replace(/^\+91\s*/, '').trim();
    const maskedPhoneNumber =
        cleanPhone.length >= 4
            ? `+91 ${cleanPhone.slice(
                0,
                2
            )}******${cleanPhone.slice(-2)}`
            : `+91 ${cleanPhone}`;

    /*
     * --------------------------------------------------
     * UI
     * --------------------------------------------------
     */

    return (
        <View style={styles.root}>
            <AppHeader
                variant="logoOnly"
                logoWidth={Math.min(screenWidth * 0.46, 220)}
            />

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

                        {/* ---------------------------------------- */}
                        {/* CHANGE PHONE NUMBER */}
                        {/* ---------------------------------------- */}

                        <Pressable
                            onPress={onChangePhone}
                            hitSlop={8}
                            style={styles.changeNumberButton}
                        >
                            <Ionicons
                                name="chevron-back"
                                size={20}
                                color={colors.primary}
                            />

                            <Text style={styles.changeNumberText}>
                                Change phone number
                            </Text>
                        </Pressable>

                        {/* ---------------------------------------- */}
                        {/* HEADING */}
                        {/* ---------------------------------------- */}

                        <Text style={styles.heading}>
                            Verify Your Number
                        </Text>

                        <Text style={styles.subheading}>
                            Enter the 6-digit OTP sent to
                        </Text>

                        <Text style={styles.phoneNumber}>
                            {maskedPhoneNumber}
                        </Text>

                        {/* ---------------------------------------- */}
                        {/* OTP */}
                        {/* ---------------------------------------- */}

                        <View style={styles.otpContainer}>
                            <Pressable onPress={handleFocusInput} hitSlop={8}>
                                <Text style={styles.otpLabel}>
                                    One-Time Password
                                </Text>
                            </Pressable>

                            <Pressable
                                onPress={handleFocusInput}
                                style={styles.otpInputWrapper}
                            >
                                <View style={styles.otpBoxes} pointerEvents="none">
                                    {Array.from({
                                        length: 6,
                                    }).map((_, index) => (
                                        <View
                                            key={index}
                                            style={[
                                                styles.otpBox,

                                                /*
                                                 * Current typing position
                                                 */
                                                otp.length === index &&
                                                styles.otpBoxActive,

                                                /*
                                                 * Already entered digits
                                                 */
                                                otp.length > index &&
                                                styles.otpBoxFilled,
                                            ]}
                                        >
                                            <Text style={styles.otpDigit}>
                                                {otp[index] || ''}
                                            </Text>
                                        </View>
                                    ))}
                                </View>

                                {/*
                                 * The real TextInput completely overlays the 6 boxes.
                                 * Direct touches on the boxes hit this input natively,
                                 * guaranteeing the keyboard pops up every time.
                                 */}
                                <TextInput
                                    ref={otpInputRef}
                                    value={otp}
                                    onChangeText={handleOtpChange}
                                    keyboardType="number-pad"
                                    maxLength={6}
                                    style={styles.realOtpInput}
                                    textContentType="oneTimeCode"
                                    autoComplete="sms-otp"
                                    returnKeyType="done"
                                    onSubmitEditing={handleVerifyOtp}
                                    caretHidden
                                />
                            </Pressable>
                        </View>

                        {/* ---------------------------------------- */}
                        {/* ERROR */}
                        {/* ---------------------------------------- */}

                        {error ? (
                            <View style={styles.errorContainer}>
                                <Text style={styles.errorText}>
                                    {error}
                                </Text>
                            </View>
                        ) : null}

                        {/* ---------------------------------------- */}
                        {/* VERIFY BUTTON */}
                        {/* ---------------------------------------- */}

                        <PrimaryButton
                            label="Verify OTP"
                            onPress={handleVerifyOtp}
                            loading={isVerifying}
                            style={styles.verifyButton}
                        />

                        {/* ---------------------------------------- */}
                        {/* RESEND */}
                        {/* ---------------------------------------- */}

                        <View style={styles.resendContainer}>
                            {secondsLeft > 0 ? (
                                <Text style={styles.resendTimer}>
                                    Resend OTP in {secondsLeft}s
                                </Text>
                            ) : (
                                <Pressable
                                    onPress={handleResendOtp}
                                    hitSlop={8}
                                    disabled={isResending}
                                >
                                    <Text style={styles.resendButton}>
                                        {isResending ? 'Sending...' : 'Resend OTP'}
                                    </Text>
                                </Pressable>
                            )}
                        </View>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>

            {/* -------------------------------------------- */}
            {/* FOOTER */}
            {/* -------------------------------------------- */}

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

/*
 * ====================================================
 * STYLES
 * ====================================================
 */

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: colors.white,
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

    /*
     * Change phone number
     */

    changeNumberButton: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: spacing.lg,
    },

    changeNumberText: {
        ...typography.bodySmall,
        color: colors.primary,
        marginLeft: spacing.xxs,
    },

    /*
     * Heading
     */

    heading: {
        ...typography.h2,
        color: colors.textPrimary,
    },

    subheading: {
        ...typography.body,
        color: colors.textSecondary,
        marginTop: spacing.xxs,
    },

    phoneNumber: {
        ...typography.body,
        color: colors.textPrimary,
        fontWeight: '700',
        marginTop: spacing.xs,
        marginBottom: spacing.lg,
    },

    /*
     * OTP
     */

    otpContainer: {
        position: 'relative',
    },

    otpLabel: {
        ...typography.bodySmall,
        color: colors.textSecondary,
        marginBottom: spacing.sm,
    },

    otpInputWrapper: {
        position: 'relative',
        width: '100%',
        height: 52,
    },

    otpBoxes: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        width: '100%',
        height: 52,
    },

    otpBox: {
        width: 45,
        height: 52,
        borderWidth: 1,
        borderColor: colors.darkGray,
        borderRadius: 8,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.white,
    },

    otpBoxActive: {
        borderColor: colors.primary,
        borderWidth: 2,
    },

    otpBoxFilled: {
        borderColor: colors.primary,
    },

    otpDigit: {
        fontSize: 22,
        fontWeight: '700',
        color: colors.textPrimary,
    },

    /*
     * The real TextInput overlays the boxes with 0.01 opacity & transparent text.
     * It captures touches directly so Android's OS window manager always opens the keyboard.
     */
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

    /*
     * Error
     */

    errorContainer: {
        backgroundColor: colors.errorBackground,
        borderRadius: 8,
        padding: spacing.sm,
        marginTop: spacing.md,
    },

    errorText: {
        ...typography.bodySmall,
        color: colors.error,
    },

    /*
     * Verify
     */

    verifyButton: {
        marginTop: spacing.lg,
    },

    /*
     * Resend
     */

    resendContainer: {
        alignItems: 'center',
        marginTop: spacing.md,
    },

    resendTimer: {
        ...typography.bodySmall,
        color: colors.textSecondary,
    },

    resendButton: {
        ...typography.bodySmall,
        color: colors.primary,
        fontWeight: '700',
    },

    /*
     * Footer
     */

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
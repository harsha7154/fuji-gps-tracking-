import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AppLogo } from '../components/AppLogo';
import { colors, spacing, typography } from '../theme';

/** How long the splash (logo + gray loader) stays before Login opens. */
export const SPLASH_DURATION_MS = 5000;

const SPLASH_GEOMETRY = require('../../assets/images/splash-bottom.png');

interface SplashScreenProps {
  /** Called once SPLASH_DURATION_MS has passed — the navigator opens Login. */
  onFinish: () => void;
}

/**
 * Splash screen: logo + gray loader for SPLASH_DURATION_MS (5 s), then
 * `onFinish()` opens the Login page automatically.
 *
 * There is no role picker any more — the role comes from the user's Liferay
 * roles at login (see api/roleApi.ts resolveAppRole).
 *
 * Not shown when a saved session is restored: AppNavigator goes straight to
 * the dashboard in that case.
 */
export const SplashScreen: React.FC<SplashScreenProps> = ({ onFinish }) => {
  const progress = useRef(new Animated.Value(0)).current;

  // Keep the latest callback without restarting the timer.
  const onFinishRef = useRef(onFinish);
  useEffect(() => {
    onFinishRef.current = onFinish;
  }, [onFinish]);

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration: SPLASH_DURATION_MS,
      easing: Easing.linear,
      useNativeDriver: false, // animates width
    });
    animation.start();

    const timer = setTimeout(() => onFinishRef.current(), SPLASH_DURATION_MS);
    return () => {
      clearTimeout(timer);
      animation.stop();
    };
  }, [progress]);

  const barWidth = progress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={styles.background}>
      <SafeAreaView style={styles.safeArea}>
        {/* Logo — top middle */}
        <View style={styles.brandingArea}>
          <AppLogo width={200} />

          <Text style={styles.heading}>PRECAST INFRASTRUCTURE MANAGEMENT SYSTEM</Text>
          <Text style={styles.subheading}>Enterprise field platform</Text>
        </View>

        {/* Gray loader */}
        <View style={styles.loaderArea} accessibilityRole="progressbar" accessibilityLabel="Loading">
          <ActivityIndicator size="large" color={colors.mediumGray} />
          <View style={styles.progressTrack}>
            <Animated.View style={[styles.progressFill, { width: barWidth }]} />
          </View>
          <Text style={styles.loaderText}>Loading…</Text>
        </View>

        {/* Decorative artwork sits behind the footer text — pulled up
            higher on screen (was 22% tall, hugging only the very bottom)
            so it reads as part of the composition rather than a thin strip
            cut off at the edge. */}
        <View style={styles.artworkArea} pointerEvents="none">
          <Image
            source={SPLASH_GEOMETRY}
            style={styles.artworkImage}
            resizeMode="cover"
            accessible={false}
          />
        </View>

        {/* Footer — moved down closer to the bottom edge, sitting on top
            of the (now taller) artwork instead of leaving a large empty
            gap above it. */}
        <View style={styles.footerArea}>
          <Text style={styles.footerTitle}>FUJI SILVERTECH CONCRETE PVT. LTD.</Text>
          <Text style={styles.footerSubtitle}>Precast India Infrastructure Mission • v2.4</Text>
        </View>
      </SafeAreaView>
    </View>
  );
};

const styles = StyleSheet.create({
  background: {
    flex: 1,
    backgroundColor: colors.concreteLighter,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
  },
  brandingArea: {
    alignItems: 'center',
    paddingTop: spacing.xl,
    paddingHorizontal: spacing.lg,
    zIndex: 2,
  },
  heading: {
    ...typography.h2,
    fontSize: 17,
    color: colors.primary,
    textAlign: 'center',
    marginTop: spacing.md,
  },
  subheading: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  loaderArea: {
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    zIndex: 2,
  },
  progressTrack: {
    width: '70%',
    maxWidth: 260,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderGray,
    overflow: 'hidden',
    marginTop: spacing.md,
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: colors.mediumGray,
  },
  loaderText: {
    ...typography.caption,
    color: colors.mediumGray,
    marginTop: spacing.xs,
    letterSpacing: 0.4,
  },
  footerArea: {
    alignItems: 'center',
    paddingBottom: spacing.sm,
    zIndex: 2,
  },
  footerTitle: {
    ...typography.footer,
    color: colors.primary,
    fontSize: 13,
    fontWeight: '800',
  },
  footerSubtitle: {
    ...typography.caption,
    color: '#FFFFFF',
    marginTop: 2,
  },
  artworkArea: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    // Brought up from 22% so the geometry graphic reads higher on screen,
    // with the footer text sitting lower/closer to it (see footerArea).
    height: '100%',
    zIndex: 1,
  },
  artworkImage: {
    width: '100%',
    height: '100%',
  },
});

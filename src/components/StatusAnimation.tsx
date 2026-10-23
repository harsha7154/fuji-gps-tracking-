/**
 * Status animation shown in the CENTRE of the screen (like a payment-app tick), no card around it.
 *
 *   kind="loading"  Delivery truck animation  (request in progress)
 *   kind="offline"  No-internet animation     (no network, server or API down) + Retry button
 *
 * The block takes the free height of the screen (window height minus the header / tab bar
 * around it) and centres the animation in it, on every phone size.
 *
 * Needs the `lottie-react-native` package:  npx expo install lottie-react-native
 * (then rebuild the dev client / APK). If the native module is missing - and always on web
 * (see LottieView.ts) - a spinner / icon is shown instead, so the screen never crashes.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import LottieView from './LottieView';
import { colors, spacing, typography } from '../theme';

const TRUCK_ANIMATION = require('../../assets/animations/truck-material-onsite.json');
const OFFLINE_ANIMATION = require('../../assets/animations/no-internet.json');

/** Space taken by the app header, back link and bottom tab bar around the animation. */
const SURROUNDING_UI_HEIGHT = 300;
const MIN_BLOCK_HEIGHT = 320;

export interface StatusAnimationProps {
  kind: 'loading' | 'offline';
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export const StatusAnimation: React.FC<StatusAnimationProps> = ({ kind, title, message, onRetry }) => {
  const { width, height } = useWindowDimensions();
  const isOffline = kind === 'offline';

  // Animation size follows the screen width (small phones -> smaller, tablets capped).
  const animationSize = Math.round(Math.min(width * (isOffline ? 0.45 : 0.6), isOffline ? 200 : 260));
  const blockHeight = Math.max(MIN_BLOCK_HEIGHT, height - SURROUNDING_UI_HEIGHT);

  return (
    <View
      style={[styles.block, { minHeight: blockHeight }]}
      accessibilityRole={isOffline ? undefined : 'progressbar'}
      accessibilityLabel={title}
    >
      {LottieView ? (
        <LottieView
          source={isOffline ? OFFLINE_ANIMATION : TRUCK_ANIMATION}
          autoPlay
          loop
          style={{ width: animationSize, height: animationSize }}
        />
      ) : isOffline ? (
        <Ionicons name="cloud-offline-outline" size={56} color={colors.statRedIcon} />
      ) : (
        <ActivityIndicator size="large" color={colors.primary} />
      )}

      {title ? <Text style={styles.title}>{title}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}

      {isOffline && onRetry ? (
        <Pressable onPress={onRetry} hitSlop={8} style={styles.retryButton}>
          <Ionicons name="refresh" size={16} color={colors.white} />
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  block: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  title: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.sm,
    textAlign: 'center',
  },
  message: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xxs,
    paddingHorizontal: spacing.sm,
  },
  retryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: spacing.md,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
  retryText: {
    color: colors.white,
    fontWeight: '600',
  },
});

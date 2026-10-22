/**
 * Full-card status animation used while data is loading or when it cannot be loaded.
 *
 *   kind="loading"  Delivery truck animation  (request in progress)
 *   kind="offline"  No-internet animation     (no network, server or API down) + Retry button
 *
 * Needs the `lottie-react-native` package:  npx expo install lottie-react-native
 * (then rebuild the dev client / APK). If the native module is missing the card falls back to a
 * spinner / icon, so the screen never crashes.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, spacing, typography } from '../theme';

const TRUCK_ANIMATION = require('../../assets/animations/delivery-truck-loading.json');
const OFFLINE_ANIMATION = require('../../assets/animations/no-internet.json');

let LottieView: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const lottie = require('lottie-react-native');
  LottieView = lottie?.default ?? lottie;
} catch {
  LottieView = null;
}

export interface StatusAnimationProps {
  kind: 'loading' | 'offline';
  title?: string;
  message?: string;
  onRetry?: () => void;
}

export const StatusAnimation: React.FC<StatusAnimationProps> = ({ kind, title, message, onRetry }) => {
  const isOffline = kind === 'offline';

  return (
    <View style={styles.card}>
      {LottieView ? (
        <LottieView
          source={isOffline ? OFFLINE_ANIMATION : TRUCK_ANIMATION}
          autoPlay
          loop
          style={isOffline ? styles.offlineAnimation : styles.truckAnimation}
        />
      ) : isOffline ? (
        <Ionicons name="cloud-offline-outline" size={44} color={colors.statRedIcon} />
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
  card: {
    alignItems: 'center',
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.md,
    marginTop: spacing.md,
    borderRadius: 12,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  truckAnimation: {
    width: 220,
    height: 220,
  },
  offlineAnimation: {
    width: 160,
    height: 160,
  },
  title: {
    ...typography.body,
    fontWeight: '700',
    color: colors.textPrimary,
    marginTop: spacing.xs,
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

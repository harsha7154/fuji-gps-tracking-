import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing, typography } from '../theme';

export interface NotificationToastData {
  /** Changes for every new toast so the timer restarts. */
  key: string;
  title: string;
  message: string;
  /** How many new notifications arrived together (shows "+N more"). */
  count: number;
}

interface NotificationToastProps {
  toast: NotificationToastData | null;
  onPress: () => void;
  onDismiss: () => void;
  /** Auto-hide after this long (ms). */
  durationMs?: number;
}

/**
 * In-app banner shown at the top of any screen when a new notification
 * arrives while the app is open. Slides down, auto-hides after 5 s;
 * tap opens the Notifications screen, ✕ dismisses.
 */
export const NotificationToast: React.FC<NotificationToastProps> = ({
  toast,
  onPress,
  onDismiss,
  durationMs = 5000,
}) => {
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-160)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!toast) return;

    translateY.setValue(-160);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true, friction: 8, tension: 70 }),
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.parallel([
        Animated.timing(translateY, { toValue: -160, duration: 220, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) onDismiss();
      });
    }, durationMs);

    return () => clearTimeout(timer);
    // onDismiss is stable (setState) — restart only for a new toast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast?.key, durationMs]);

  if (!toast) return null;

  const extra = toast.count > 1 ? toast.count - 1 : 0;

  return (
    <Animated.View
      pointerEvents="box-none"
      style={[
        styles.wrapper,
        { top: insets.top + spacing.xs, opacity, transform: [{ translateY }] },
      ]}
    >
      <Pressable
        onPress={onPress}
        accessibilityRole="alert"
        accessibilityLabel={`New notification: ${toast.title}. ${toast.message}`}
        style={({ pressed }) => [styles.toast, pressed && styles.toastPressed]}
      >
        <View style={styles.iconCircle}>
          <Ionicons name="notifications" size={18} color={colors.white} />
        </View>

        <View style={styles.body}>
          <View style={styles.topRow}>
            <Text style={styles.eyebrow}>NEW NOTIFICATION</Text>
            {extra > 0 ? (
              <View style={styles.morePill}>
                <Text style={styles.moreText}>+{extra} more</Text>
              </View>
            ) : null}
          </View>
          <Text style={styles.title} numberOfLines={1}>
            {toast.title}
          </Text>
          <Text style={styles.message} numberOfLines={2}>
            {toast.message}
          </Text>
        </View>

        <Pressable
          onPress={onDismiss}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          style={styles.closeButton}
        >
          <Ionicons name="close" size={16} color={colors.neutralGray} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    zIndex: 1000,
    elevation: 12,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderLeftWidth: 4,
    borderLeftColor: colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 12,
  },
  toastPressed: {
    opacity: 0.9,
  },
  iconCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    marginRight: spacing.sm,
  },
  body: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  eyebrow: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: colors.primary,
  },
  morePill: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.statBlueBg,
  },
  moreText: {
    ...typography.caption,
    fontSize: 10,
    fontWeight: '700',
    color: colors.primary,
  },
  title: {
    ...typography.label,
    fontSize: 15,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 2,
  },
  message: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 18,
  },
  closeButton: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.xxs,
    backgroundColor: colors.concreteLighter,
  },
});

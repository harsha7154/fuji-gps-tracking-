// src/components/AppHeader.tsx
import React from 'react';
import {
  Image,
  ImageBackground,
  StyleSheet,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { AppLogo } from './AppLogo';
import { HeaderIconButton } from './HeaderIconButton';
import { colors, spacing } from '../theme';

const HEADER_CURVE_BG = require('../../assets/images/header-curve-bg1.png');
const BLUE_ACCENT_LINE = require('../../assets/images/blue-accent-line.png');

/**
 * Shared per-screen header.
 *
 * Variants:
 * - "curved"   — the blue curved hero background (dashboards, activity,
 *                progress, watermark/submission screens).
 * - "flat"     — plain white header with an optional blue accent line
 *                underneath (Engineer Profile).
 * - "logoOnly" — centered logo only, no actions (Login screen).
 */
export type AppHeaderVariant = 'curved' | 'flat' | 'logoOnly';

interface AppHeaderProps {
  variant?: AppHeaderVariant;
  logoWidth?: number;
  safeArea?: boolean;

  showNotification?: boolean;
  notificationCount?: number;
  notificationBadgeColor?: string;
  onNotificationPress?: () => void;

  showAvatar?: boolean;
  avatarIcon?: keyof typeof Ionicons.glyphMap;
  avatarLabel?: string;
  avatarIconColor?: string;
  avatarBackgroundColor?: string;
  avatarSize?: number;
  onAvatarPress?: () => void;

  centerSlot?: React.ReactNode;
  showAccentLine?: boolean;

  style?: ViewStyle;
  contentStyle?: ViewStyle;
}

// Design height of the header artwork with NO status-bar inset added —
// i.e. what it looks like on a device with insets.top === 0. The actual
// rendered box height is always this PLUS the current inset (see
// topInset below), so the curve/logo content keeps its intended size and
// position instead of being squeezed into a fixed box that's now too
// short once padding is added for the status bar.
const CURVED_HEADER_BASE_HEIGHT = 150;
const LOGO_ONLY_HEADER_BASE_HEIGHT = 170;

export const AppHeader: React.FC<AppHeaderProps> = ({
  variant = 'curved',
  logoWidth,
  safeArea = true,
  showNotification = true,
  notificationCount = 0,
  notificationBadgeColor,
  onNotificationPress,
  showAvatar = true,
  avatarIcon = 'person',
  avatarLabel,
  avatarIconColor = colors.avatarIcon,
  avatarBackgroundColor = colors.avatarBg,
  avatarSize = 40,
  onAvatarPress,
  centerSlot,
  showAccentLine = false,
  style,
  contentStyle,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const resolvedLogoWidth =
    logoWidth ?? Math.min(screenWidth * 0.4, variant === 'logoOnly' ? 220 : 190);

  const actions = (
    <View style={styles.headerActions}>
      {centerSlot}
      {showNotification ? (
        <HeaderIconButton
          icon="notifications-outline"
          accessibilityLabel="Notifications"
          badgeCount={notificationCount}
          badgeColor={notificationBadgeColor}
          onPress={onNotificationPress ?? (() => {})}
        />
      ) : null}
      {showAvatar ? (
        <HeaderIconButton
          icon={avatarIcon}
          label={avatarLabel}
          iconColor={avatarIconColor}
          labelColor={avatarIconColor}
          backgroundColor={avatarBackgroundColor}
          accessibilityLabel="My Profile"
          onPress={onAvatarPress ?? (() => {})}
          size={avatarSize}
        />
      ) : null}
    </View>
  );

  // Top inset (status bar height) applied as padding INSIDE the header's
  // own background — not as a separate solid-color block above it — so
  // the curved/logo artwork itself extends behind the status bar icons
  // instead of showing a flat strip. `safeArea={false}` opts out entirely
  // (e.g. a screen that positions its own header lower down).
  const topInset = safeArea ? insets.top : 0;

  if (variant === 'logoOnly') {
    return (
      <ImageBackground
        source={HEADER_CURVE_BG}
        style={[
          styles.logoOnlyHeader,
          { height: LOGO_ONLY_HEADER_BASE_HEIGHT + topInset, paddingTop: topInset },
          style,
          contentStyle,
        ]}
        resizeMode="cover"
      >
        <View style={styles.logoOnlyContent}>
          <AppLogo width={resolvedLogoWidth} />
        </View>
      </ImageBackground>
    );
  }

  if (variant === 'flat') {
    return (
      <View style={style}>
        <View
          style={[styles.flatRow, { paddingTop: topInset + spacing.sm }, contentStyle]}
        >
          <AppLogo width={resolvedLogoWidth} style={styles.headerLogo} />
          {actions}
        </View>
        {showAccentLine ? (
          <Image source={BLUE_ACCENT_LINE} style={styles.accentLine} resizeMode="stretch" />
        ) : null}
      </View>
    );
  }

  // "curved" (default)
  return (
    <ImageBackground
      source={HEADER_CURVE_BG}
      style={[
        styles.curvedHeader,
        { height: CURVED_HEADER_BASE_HEIGHT + topInset, paddingTop: topInset },
        style,
        contentStyle,
      ]}
      resizeMode="cover"
    >
      <View style={styles.curvedRow}>
        <AppLogo width={resolvedLogoWidth} style={styles.headerLogo} />
        {actions}
      </View>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  curvedHeader: {
    width: '100%',
  },
  curvedRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },

  flatRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
    backgroundColor: colors.white,
  },
  accentLine: {
    width: '100%',
    height: 3,
  },

  logoOnlyHeader: {
    width: '100%',
    alignItems: 'center',
  },
  logoOnlyContent: {
    alignItems: 'center',
    paddingTop: 20,
  },

  headerLogo: {
    alignItems: 'flex-start',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
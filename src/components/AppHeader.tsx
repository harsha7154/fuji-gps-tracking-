// src/components/AppHeader.tsx
import React from 'react';
import {
  Image,
  ImageBackground,
  Pressable,
  StyleSheet,
  Text,
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
// Driver dashboard artwork (concrete + blue curve on the left, buildings + truck on the right).
// Logo and buttons are NOT in the image; they are drawn on top so they stay sharp and tappable.
const PHOTO_HEADER_BG = require('../../assets/images/dashboard-header.png');
// Artwork size in px; logo / button positions below are in the same units.
const PHOTO_ART_WIDTH = 919;
const PHOTO_ART_HEIGHT = 210;
// Positions on the artwork (same px units), taken from the dashboard design:
// logo on the concrete, inside the blue curve; bell + avatar top-right on the sky.
const PHOTO_LOGO = { left: 50, top: 28, width: 210 };
const PHOTO_ACTIONS = { right: 55, centerY: 55, size: 73, gap: 24 };
const BLUE_ACCENT_LINE = require('../../assets/images/blue-accent-line.png');
// Inner pages (Profile, My Trip, Live GPS, History, Settings, Notifications): construction site
// photo with the blue wave at the bottom. Logo, back link and buttons are NOT in the image; they
// are drawn on top. Below the wave the image is transparent, so the page colour shows through.
const HERO_HEADER_BG = require('../../assets/images/profile-header.png');
// Artwork size in px; every position below is in the same units (scaled to the screen width).
const HERO_ART_WIDTH = 887;
const HERO_ART_HEIGHT = 270;
const HERO_LOGO = { left: 55, top: 62, width: 200 };
const HERO_BACK = { left: 50, centerY: 33 };
const HERO_ACTIONS = { right: 41, centerY: 52, size: 72 };
/** Page colour under the hero header in the design (light blue-white). */
export const HERO_PAGE_BACKGROUND = '#F2F8FD';

/**
 * Shared per-screen header.
 *
 * Variants:
 * - "curved"   — the blue curved hero background (dashboards, activity,
 *                progress, watermark/submission screens).
 * - "flat"     — plain white header with an optional blue accent line
 *                underneath (Engineer Profile).
 * - "logoOnly" — centered logo only, no actions (Login screen).
 * - "photo"    — driver dashboard artwork (concrete + blue curve + buildings and
 *                truck), logo on the concrete side, actions on the photo side.
 * - "hero"     — inner pages: site photo + blue wave, "< Back to …" link and logo on
 *                the left, bell and avatar on the right.
 */
export type AppHeaderVariant = 'curved' | 'flat' | 'logoOnly' | 'photo' | 'hero';

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

  /** "hero" only: back link shown top-left, e.g. "Back to Dashboard". */
  backLabel?: string;
  onBack?: () => void;

  style?: ViewStyle;
  contentStyle?: ViewStyle;
}

// Design height of the header artwork with NO status-bar inset added —
// i.e. what it looks like on a device with insets.top === 0. The actual
// rendered box height is always this PLUS the current inset (see
// topInset below), so the curve/logo content keeps its intended size and
// position instead of being squeezed into a fixed box that's now too
// short once padding is added for the status bar.
// Design height of the header artwork with NO status-bar inset added
const CURVED_HEADER_BASE_HEIGHT = 145;

export const AppHeader: React.FC<AppHeaderProps> = ({
  variant = 'photo',
  logoWidth,
  safeArea = true,
  showNotification = true,
  notificationCount = 0,
  notificationBadgeColor = '#0B5FA8',
  onNotificationPress,
  showAvatar = true,
  avatarIcon = 'person',
  avatarLabel,
  avatarIconColor = '#D97706',
  avatarBackgroundColor = '#FEF3D6',
  avatarSize = 40,
  onAvatarPress,
  centerSlot,
  showAccentLine = false,
  backLabel,
  onBack,
  style,
  contentStyle,
}) => {
  const { width: screenWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const topInset = safeArea ? insets.top : 0;
  const artHeight = Math.max(128, Math.round(screenWidth * 0.36));
  const totalHeight = artHeight + topInset;
  const buttonSize = avatarSize || 40;

  // Normalized colors matching the attached UI design:
  // - Notification badge is vibrant blue (#0B5FA8)
  // - Avatar is warm peach/cream (#FEF3D6) with amber person icon (#D97706)
  const resolvedBadgeColor =
    notificationBadgeColor === '#EF4444' || !notificationBadgeColor
      ? '#0B5FA8'
      : notificationBadgeColor;

  const resolvedAvatarBg =
    avatarBackgroundColor === colors.white ||
    avatarBackgroundColor === '#FFFFFF' ||
    !avatarBackgroundColor
      ? '#FEF3D6'
      : avatarBackgroundColor;

  const resolvedAvatarIconColor =
    avatarIconColor === '#0B5FA8' || !avatarIconColor
      ? '#D97706'
      : avatarIconColor;

  const resolvedLogoWidth =
    logoWidth ?? Math.min(screenWidth * 0.38, 140);

  if (variant === 'photo' || variant === 'hero' || variant === 'curved' || !variant) {
    return (
      <>
        <View style={[styles.photoHeader, { height: totalHeight, paddingTop: topInset }, style]}>
          <Image
            source={HEADER_CURVE_BG}
            style={{ width: screenWidth, height: totalHeight, position: 'absolute', top: 0, left: 0 }}
            resizeMode="cover"
            accessible={false}
          />
          <AppLogo
            width={resolvedLogoWidth}
            style={{ position: 'absolute', left: 16, top: topInset + 10 }}
          />
          <View
            style={[
              styles.photoActions,
              {
                right: 16,
                top: topInset + 10,
                gap: 10,
              },
              contentStyle,
            ]}
          >
            {centerSlot}
            {showNotification ? (
              <HeaderIconButton
                icon="notifications-outline"
                accessibilityLabel="Notifications"
                badgeCount={notificationCount}
                badgeColor={resolvedBadgeColor}
                onPress={onNotificationPress ?? (() => {})}
                size={buttonSize}
                backgroundColor="#FFFFFF"
                iconColor="#0B5FA8"
                elevated
              />
            ) : null}
            {showAvatar ? (
              <HeaderIconButton
                icon={avatarIcon}
                label={avatarLabel}
                iconColor={resolvedAvatarIconColor}
                labelColor={resolvedAvatarIconColor}
                backgroundColor={resolvedAvatarBg}
                accessibilityLabel="My Profile"
                onPress={onAvatarPress ?? (() => {})}
                size={buttonSize}
                elevated
              />
            ) : null}
          </View>
        </View>
        {/* Back link under the artwork */}
        {onBack ? (
          <View style={styles.backRow}>
            <Pressable
              onPress={onBack}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={backLabel ?? 'Back'}
              style={({ pressed }) => [styles.backLink, pressed && styles.backLinkPressed]}
            >
              <Ionicons name="chevron-back" size={16} color={colors.primary} />
              <Text style={styles.backLinkText}>{backLabel ?? 'Back'}</Text>
            </Pressable>
          </View>
        ) : null}
      </>
    );
  }

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

  // Flat fallback
  return (
    <View style={style}>
      <View style={[styles.flatRow, { paddingTop: topInset + spacing.sm }, contentStyle]}>
        <AppLogo width={resolvedLogoWidth} style={styles.headerLogo} />
        <View style={styles.headerActions}>
          {centerSlot}
          {showNotification ? (
            <HeaderIconButton
              icon="notifications-outline"
              accessibilityLabel="Notifications"
              badgeCount={notificationCount}
              badgeColor={resolvedBadgeColor}
              onPress={onNotificationPress ?? (() => {})}
            />
          ) : null}
          {showAvatar ? (
            <HeaderIconButton
              icon={avatarIcon}
              label={avatarLabel}
              iconColor={resolvedAvatarIconColor}
              labelColor={resolvedAvatarIconColor}
              backgroundColor={resolvedAvatarBg}
              accessibilityLabel="My Profile"
              onPress={onAvatarPress ?? (() => {})}
              size={avatarSize}
            />
          ) : null}
        </View>
      </View>
      {showAccentLine ? (
        <Image source={BLUE_ACCENT_LINE} style={styles.accentLine} resizeMode="stretch" />
      ) : null}
    </View>
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

  photoHeader: {
    width: '100%',
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  backRow: {
    paddingHorizontal: spacing.md,
  },
  backLink: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#E2E8F0',
    borderRadius: 20,
    paddingVertical: 7,
    paddingHorizontal: 14,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1.5 },
    shadowOpacity: 0.07,
    shadowRadius: 3,
    elevation: 2,
  },
  backLinkPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.97 }],
    backgroundColor: '#F8FAFC',
  },
  backLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0B5FA8',
    letterSpacing: -0.1,
  },
  photoActions: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
  },
  photoContentRow: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heroHeader: {
    width: '100%',
  },
  heroBack: {
    position: 'absolute',
    height: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingRight: 6,
  },
  heroBackPressed: {
    opacity: 0.6,
  },
  heroBackText: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.primary,
    textShadowColor: 'rgba(255,255,255,0.9)',
    textShadowRadius: 6,
  },
  heroActions: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
});
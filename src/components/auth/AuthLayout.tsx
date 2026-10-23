/**
 * Shared pieces of the Login and OTP screens (same design on both):
 *
 *   AuthTopBand      concrete band behind the status bar with the logo; its lower edge is a curve
 *                    with a blue line (low on the left, rising to the top-right corner).
 *   AuthHero         full-width illustration under the top band.
 *   AuthBottomBand   skyline + concrete band at the bottom with the SAME blue line (same
 *                    thickness, low on the left, rising to the right) + company name.
 *   AuthSubmitButton blue rounded button with the arrow circle on the right.
 *
 * All sizes follow the screen width (artwork designed at 868 px wide), so the layout is the same
 * on every phone. The curves are SVG, so they stay sharp at any size.
 */
import React from 'react';
import {
  ActivityIndicator,
  Image,
  ImageSourcePropType,
  Pressable,
  StyleProp,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import Svg, { ClipPath, Defs, Image as SvgImage, Path } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { AppLogo } from '../AppLogo';
import { colors, spacing } from '../../theme';

const CONCRETE = require('../../../assets/images/auth-concrete.png');
const SKYLINE = require('../../../assets/images/auth-skyline.png');

export const AUTH_HERO_LOGIN = require('../../../assets/images/auth-hero-login.png');
export const AUTH_HERO_OTP = require('../../../assets/images/auth-hero-otp.png');

/** Width of the artwork the coordinates below come from. */
const DESIGN_WIDTH = 868;
/** Blue line thickness, identical at the top and the bottom (design px). */
const LINE_WIDTH = 9;

// ── geometry (design px) ─────────────────────────────────────────────────────
const TOP_BAND_HEIGHT = 392;
/**
 * Hero artwork starts this far below the top of the top band. Its part above the curve is
 * transparent, so the scene reaches up under the curve (the concrete band covers the rest).
 */
const HERO_OFFSET = 160;
const SKYLINE_HEIGHT = 370;
/** Bottom band starts this far below the top of the skyline image. */
const BOTTOM_BAND_OFFSET = 185;
const BOTTOM_BAND_HEIGHT = 297;

/** Top curve: low on the left, flat in the middle, rising to the top-right corner. */
function topCurve(s: number, dy: number): string {
  const p = (x: number, y: number) => `${(x * s).toFixed(1)},${(y * s + dy).toFixed(1)}`;
  return `M${p(0, 378)} C${p(180, 345)} ${p(380, 342)} ${p(470, 334)} C${p(640, 318)} ${p(760, 245)} ${p(DESIGN_WIDTH, 163)}`;
}

/** Bottom curve: same direction (low left -> high right), concrete below it. */
function bottomCurve(s: number): string {
  const p = (x: number, y: number) => `${(x * s).toFixed(1)},${(y * s).toFixed(1)}`;
  return `M${p(0, 155)} C${p(289, 118)} ${p(579, 72)} ${p(DESIGN_WIDTH, 16)}`;
}

function useScale() {
  const { width } = useWindowDimensions();
  return { width, s: width / DESIGN_WIDTH };
}

/** Design px (868-wide artwork) -> dp on this phone. */
export function useAuthScale(): number {
  return useScale().s;
}

// ── top band ─────────────────────────────────────────────────────────────────

export const AuthTopBand: React.FC = () => {
  const { width, s } = useScale();
  const { top: inset } = useSafeAreaInsets();
  const height = TOP_BAND_HEIGHT * s + inset;
  const curve = topCurve(s, inset);
  // Area above the curve: top-left -> top-right, then along the curve back to the left edge.
  const fill = `M0,0 L${width.toFixed(1)},0 ${reversePath(curve)} Z`;

  const logoWidth = Math.min(width * 0.5, 230);

  return (
    <View style={[styles.topBand, { height }]} pointerEvents="box-none">
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <ClipPath id="authTopClip">
            <Path d={fill} />
          </ClipPath>
        </Defs>
        <SvgImage
          href={CONCRETE}
          x={0}
          y={0}
          width={width}
          height={height}
          preserveAspectRatio="xMidYMid slice"
          clipPath="url(#authTopClip)"
        />
        <Path d={curve} stroke={colors.primary} strokeWidth={LINE_WIDTH * s} strokeLinecap="round" fill="none" />
      </Svg>
      <View style={[styles.logoWrap, { paddingTop: inset + 70 * s }]}>
        <AppLogo width={logoWidth} />
      </View>
    </View>
  );
};

/**
 * Same cubic curve drawn the other way (right -> left), used to close the concrete area.
 * Input: "M a C b c d C e f g" -> output: "L g C f e d C c b a".
 */
function reversePath(curve: string): string {
  const parts = curve.replace(/^M/, '').split(' C');
  const start = parts[0];
  const segs = parts.slice(1).map((seg) => seg.trim().split(' '));
  const end = segs[segs.length - 1][2];
  const reversed: string[] = [];
  for (let i = segs.length - 1; i >= 0; i -= 1) {
    const [c1, c2] = segs[i];
    const from = i === 0 ? start : segs[i - 1][2];
    reversed.push(`C${c2} ${c1} ${from}`);
  }
  return `L${end} ${reversed.join(' ')}`;
}

// ── hero ─────────────────────────────────────────────────────────────────────

export const AuthHero: React.FC<{
  source: ImageSourcePropType;
  /** Height of the artwork in design px (width is always 868). */
  designHeight: number;
  children?: React.ReactNode;
}> = ({ source, designHeight, children }) => {
  const { width, s } = useScale();
  return (
    <View style={{ width, height: designHeight * s, marginTop: -(TOP_BAND_HEIGHT - HERO_OFFSET) * s }}>
      <Image source={source} style={{ width, height: designHeight * s }} resizeMode="cover" />
      {children}
    </View>
  );
};

// ── bottom band ──────────────────────────────────────────────────────────────

export const AuthBottomBand: React.FC = () => {
  const { width, s } = useScale();
  const { bottom: inset } = useSafeAreaInsets();
  const bandHeight = BOTTOM_BAND_HEIGHT * s + inset;
  const curve = bottomCurve(s);
  const fill = `${curve} L${width.toFixed(1)},${bandHeight.toFixed(1)} L0,${bandHeight.toFixed(1)} Z`;

  return (
    <View pointerEvents="none">
      <Image
        source={SKYLINE}
        style={{ width, height: SKYLINE_HEIGHT * s, marginTop: -40 * s }}
        resizeMode="cover"
      />
      <View
        style={{
          width,
          height: bandHeight,
          marginTop: -(SKYLINE_HEIGHT - BOTTOM_BAND_OFFSET) * s,
        }}
      >
        <Svg width={width} height={bandHeight} style={StyleSheet.absoluteFill}>
          <Defs>
            <ClipPath id="authBottomClip">
              <Path d={fill} />
            </ClipPath>
          </Defs>
          <SvgImage
            href={CONCRETE}
            x={0}
            y={0}
            width={width}
            height={bandHeight}
            preserveAspectRatio="xMidYMid slice"
            clipPath="url(#authBottomClip)"
          />
          <Path d={curve} stroke={colors.primary} strokeWidth={LINE_WIDTH * s} strokeLinecap="round" fill="none" />
        </Svg>
        <View style={[styles.footerText, { paddingBottom: Math.max(inset, spacing.sm) + 14 * s }]}>
          <Text style={styles.footerTitle}>FUJI SILVERTECH CONCRETE PVT. LTD.</Text>
          <Text style={styles.footerSubtitle}>The Future is Precast</Text>
        </View>
      </View>
    </View>
  );
};

// ── button ───────────────────────────────────────────────────────────────────

export const AuthSubmitButton: React.FC<{
  label: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}> = ({ label, onPress, loading = false, disabled = false, style }) => (
  <Pressable
    onPress={onPress}
    disabled={disabled || loading}
    accessibilityRole="button"
    accessibilityLabel={label}
    accessibilityState={{ disabled: disabled || loading, busy: loading }}
    style={({ pressed }) => [
      styles.button,
      (disabled || loading) && styles.buttonDim,
      pressed && styles.buttonPressed,
      style,
    ]}
  >
    <Text style={styles.buttonText}>{label}</Text>
    <View style={styles.buttonArrow}>
      {loading ? (
        <ActivityIndicator size="small" color={colors.white} />
      ) : (
        <Ionicons name="arrow-forward" size={22} color={colors.white} />
      )}
    </View>
  </Pressable>
);

const styles = StyleSheet.create({
  topBand: {
    width: '100%',
    zIndex: 2,
  },
  logoWrap: {
    alignItems: 'center',
  },
  footerText: {
    flex: 1,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  footerTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 0.2,
  },
  footerSubtitle: {
    fontSize: 13,
    color: colors.textPrimary,
    marginTop: 4,
  },
  button: {
    height: 56,
    borderRadius: 16,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  buttonDim: {
    opacity: 0.75,
  },
  buttonPressed: {
    opacity: 0.88,
  },
  buttonText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  buttonArrow: {
    position: 'absolute',
    right: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
});

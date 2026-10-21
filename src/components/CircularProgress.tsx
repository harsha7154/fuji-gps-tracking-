import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { colors } from '../theme';

interface CircularProgressProps {
  /** 0–100 */
  progress: number;
  size?: number;
  strokeWidth?: number;
  trackColor?: string;
  progressColor?: string;
  children?: React.ReactNode;
}

/**
 * A ring progress indicator (used in "My Progress"). Renders an SVG track
 * circle plus a progress arc, with optional centered content (icon/label).
 */
export const CircularProgress: React.FC<CircularProgressProps> = ({
  progress,
  size = 72,
  strokeWidth = 7,
  trackColor = colors.concreteLight,
  progressColor = colors.primary,
  children,
}) => {
  const clampedProgress = Math.max(0, Math.min(100, progress));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - clampedProgress / 100);
  const center = size / 2;

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      <Svg width={size} height={size}>
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={trackColor}
          strokeWidth={strokeWidth}
          fill="none"
        />
        <Circle
          cx={center}
          cy={center}
          r={radius}
          stroke={progressColor}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={strokeDashoffset}
          // Start the arc at 12 o'clock instead of 3 o'clock.
          rotation={-90}
          origin={`${center}, ${center}`}
        />
      </Svg>
      {children ? <View style={styles.centerContent}>{children}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerContent: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

/**
 * Solid strip behind the Android/iOS status bar (time, network, battery icons).
 *
 * The status bar is translucent (app.json) and every screen's header scrolls with its content,
 * so without this strip the logo / cards slide under the status-bar icons when the user scrolls.
 * The strip has exactly the status-bar height (safe-area top inset, different on every phone),
 * uses the top colour of the header artwork, and does not take touches.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Average colour of the top of assets/images/header-curve-bg1.png (concrete grey). */
export const STATUS_BAR_BACKDROP_COLOR = '#D8D7D8';

export const StatusBarBackdrop: React.FC = () => {
  const { top } = useSafeAreaInsets();
  if (top <= 0) return null;
  return <View pointerEvents="none" style={[styles.backdrop, { height: top }]} />;
};

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 1000,
    elevation: 1000,
    backgroundColor: STATUS_BAR_BACKDROP_COLOR,
  },
});

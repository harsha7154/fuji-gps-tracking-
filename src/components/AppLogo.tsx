import React from 'react';
import { Image, StyleSheet, View, ViewStyle } from 'react-native';

interface AppLogoProps {
  /** Rendered width in dp. Height is derived from the logo's native aspect ratio. */
  width?: number;
  style?: ViewStyle;
}

// Native pixel dimensions of the supplied logo asset, used to preserve
// aspect ratio exactly (do not stretch or distort the official logo).
const LOGO_ASSET = require('../../assets/images/fujisilvertlogo.png');
const LOGO_NATIVE_WIDTH = 307;
const LOGO_NATIVE_HEIGHT = 161;
const LOGO_ASPECT_RATIO = LOGO_NATIVE_WIDTH / LOGO_NATIVE_HEIGHT;

/**
 * Official FUJI SILVERTECH logo. Do not recolor, redraw, or replace this
 * asset — it is rendered exactly as supplied.
 */
export const AppLogo: React.FC<AppLogoProps> = ({ width = 220, style }) => {
  return (
    <View style={[styles.container, style]}>
      <Image
        source={LOGO_ASSET}
        style={{ width, height: width / LOGO_ASPECT_RATIO }}
        resizeMode="contain"
        accessible
        accessibilityRole="image"
        accessibilityLabel="FUJI SILVERTECH — The Future is Precast"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

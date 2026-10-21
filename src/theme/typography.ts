import { Platform } from 'react-native';

/**
 * Centralized typography scale. Uses system fonts for now; swap
 * `fontFamily` values here if Fuji Silvertech supplies brand fonts later.
 */
const systemFont = Platform.select({
  ios: 'System',
  android: 'sans-serif',
  default: 'System',
});

export const typography = {
  fontFamily: systemFont,

  h1: {
    fontSize: 26,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  h2: {
    fontSize: 22,
    fontWeight: '700' as const,
  },
  body: {
    fontSize: 15,
    fontWeight: '400' as const,
  },
  bodySmall: {
    fontSize: 13,
    fontWeight: '400' as const,
  },
  label: {
    fontSize: 14,
    fontWeight: '500' as const,
  },
  button: {
    fontSize: 16,
    fontWeight: '600' as const,
    letterSpacing: 0.3,
  },
  caption: {
    fontSize: 12,
    fontWeight: '400' as const,
  },
  footer: {
    fontSize: 12,
    fontWeight: '600' as const,
    letterSpacing: 0.4,
  },
} as const;

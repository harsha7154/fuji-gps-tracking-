/**
 * Centralized spacing scale. Use these instead of hardcoded margin/padding
 * numbers so screen density can be tuned in one place.
 */
export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  xxxl: 64,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  pill: 999,
} as const;

export const touchTarget = {
  minHeight: 48,
} as const;

/**
 * FUJI SILVERTECH CONCRETE PVT. LTD. — Brand Color System
 *
 * These values were derived from the supplied brand assets
 * (logo, blue accent line, concrete background, splash/login reference).
 * If Fuji Silvertech's official brand guidelines specify exact hex values,
 * replace the values below — do not scatter new hex values elsewhere.
 */

export const colors = {
  // Primary brand blue — accent line, CTA buttons, links, focus states
  primary: '#0B5FA8',
  primaryDark: '#08477E',
  primaryLight: '#4C8FCB',

  // Charcoal / near-black — logo mark, primary headings, splash bottom block
  charcoal: '#231F20',
  charcoalDark: '#18191A',

  // Grays — concrete tones used across backgrounds, borders, secondary text
  darkGray: '#404041',
  mediumGray: '#6D6E70',
  neutralGray: '#929497',
  borderGray: '#D9D9D9',
  concreteLight: '#EDEDED',
  concreteLighter: '#F5F5F5',

  // Base
  white: '#FFFFFF',
  black: '#000000',

  // Semantic
  textPrimary: '#231F20',
  textSecondary: '#6D6E70',
  textPlaceholder: '#9A9A9C',
  error: '#C62828',
  errorBackground: '#FDECEC',
  success: '#2E7D32',
  warning: '#E8920C',
  disabled: '#B7B7B9',
  overlay: 'rgba(0,0,0,0.35)',

  // Dashboard — stat / icon badge backgrounds & foregrounds
  // (light tint background behind a colored icon, per the summary cards)
  statBlueBg: '#E3F0FA',
  statBlueIcon: '#0B5FA8',
  statGreenBg: '#E4F5E7',
  statGreenIcon: '#2E9E4F',
  statOrangeBg: '#FEF1DC',
  statOrangeIcon: '#E8920C',
  statRedBg: '#FBE7E7',
  statRedIcon: '#D64545',

  avatarBg: '#CFE3F5',
  avatarIcon: '#0B5FA8',

  cardBorder: '#E7E8EA',
  tabInactive: '#9A9A9C',
} as const;

export type ColorKey = keyof typeof colors;

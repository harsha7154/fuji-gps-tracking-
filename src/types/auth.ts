/**
 * Auth-related types.
 *
 * IMPORTANT: The shape of `LoginResponse` is a placeholder. Do not treat
 * this as the real Liferay Headless API response contract. Replace this
 * once the actual Liferay endpoint/response format is provided.
 */

/**
 * The two operational roles selectable on the Splash / role-select screen.
 * Add new roles here (and to ROLE_LABELS below) if the business adds more
 * field roles later — every other file derives its role list from this type.
 */
export type UserRole = 'SITE_ENGINEER' | 'TRUCK_DRIVER';

export const ROLE_LABELS: Record<UserRole, string> = {
  SITE_ENGINEER: 'Site Engineer',
  TRUCK_DRIVER: 'Truck Driver',
};

export interface LoginCredentials {
  usernameOrEmail: string;
  password: string;
}

/**
 * Logged-in user profile shown across the app post-login (dashboard header,
 * greeting, avatar, etc). Placeholder shape — replace with the real Liferay
 * user fields (e.g. from /o/headless-admin-user/.../my-user-account) once
 * the Headless API is wired up.
 *
 * `vehicleNumber` / `vehicleModel` are only populated for TRUCK_DRIVER
 * accounts (used by DriverDashboardScreen's vehicle plate + info card).
 */
export interface UserProfile {
  id: string;
  firstName: string;
  familyName?: string;
  fullName: string;
  alternateName?: string;
  email?: string;
  jobTitle?: string;
  role: UserRole;
  avatarUrl?: string;
  externalReferenceCode?: string;
  dateCreated?: string;
  lastLoginDate?: string;
  status?: string;
  vehicleNumber?: string;
  vehicleModel?: string;
}

export interface LoginResponse {
  // UPDATED: split into accessToken + refreshToken to support persistent
  // login sessions (see sessionStorage.ts / AppNavigator's session-restore
  // and proactive-refresh logic). accessToken is short-lived; refreshToken
  // is used to silently obtain a new one without asking for the password
  // again. refreshToken is optional because the mock/demo accounts in
  // authService.ts don't produce one (there's no real OAuth2 session to
  // refresh for those).
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  user: UserProfile;
}

export type AuthErrorCode =
  | 'INVALID_CREDENTIALS'
  | 'ROLE_MISMATCH'
  | 'ACCESS_DENIED'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'UNKNOWN';

/**
 * Maps our app-level UserRole to the exact Liferay role `key` (not the
 * display `name`) found in a user account's `roleBriefs[]`. These are
 * case-sensitive and confirmed against real Liferay responses — do not
 * "clean up" the casing/spacing.
 *
 *   TRUCK_DRIVER   -> roleBriefs[].key === "driver"
 *   SITE_ENGINEER  -> roleBriefs[].key === "Site Engineer"
 *
 * The generic "User" role key is present on every account (it's Liferay's
 * default role) and is intentionally NOT used to identify anything.
 */
export const LIFERAY_ROLE_KEYS: Record<UserRole, string> = {
  TRUCK_DRIVER: 'driver',
  SITE_ENGINEER: 'Site Engineer',
};

export interface AuthError {
  code: AuthErrorCode;
  message: string;
  /** Raw underlying error, kept for logging/debugging only — never shown to the user. */
  cause?: unknown;
}

export type LoginResult =
  | { success: true; data: LoginResponse }
  | { success: false; error: AuthError };

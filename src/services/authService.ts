/**
 * Authentication service.
 *
 * This is the ONLY place that should know how login is actually performed.
 * LoginScreen calls `authService.login()` and never touches fetch/the API
 * client directly.
 *
 * Two login paths, tried in order:
 *   1. DUMMY ACCOUNTS — a small hardcoded list (see MOCK_ACCOUNTS below).
 *      These always work, regardless of whether the real Liferay server is
 *      reachable, and are meant to stay available permanently for demos/
 *      QA/offline testing — not just as a "no backend yet" placeholder.
 *
 *   2. REAL LIFERAY LOGIN — anything that isn't a dummy account goes
 *      through the actual Liferay OAuth2 + Headless Admin User APIs:
 *        a. POST /o/oauth2/token          (client_credentials grant)
 *        b. GET  /user-accounts/by-email-address/{email} (bearer token)
 *        c. Resolve the app role from roleBriefs (see resolveAppRole in
 *           ../api/roleApi.ts): GET /user-accounts/{id}, skipping the
 *           default "User" role, matching "driver" / "Site Engineer".
 *
 *   3. MOBILE OTP LOGIN — new phone-number authentication:
 *        a. POST /o/mobile-auth/send-otp
 *        b. POST /o/mobile-auth/verify-otp
 */

import {
  apiClient,
  ApiClientNotConfiguredError,
  fetchWithTimeout,
  getBaseUrl,
} from '../api/client';

import { resolveAppRole } from '../api/roleApi';

import type {
  AuthError,
  LoginCredentials,
  LoginResponse,
  LoginResult,
  UserProfile,
  UserRole,
} from '../types/auth';

import {
  LIFERAY_ROLE_KEYS,
  ROLE_LABELS,
} from '../types/auth';

const MOCK_LOGIN_DELAY_MS = 700;

// send-otp / verify-otp had no timeout, so a stalled connection kept the Login / OTP spinner
// up forever. Same 15 s limit as the other Liferay calls; a timeout surfaces as the existing
// 'The request timed out. Please try again.' message (toAuthError -> TIMEOUT).
const OTP_REQUEST_TIMEOUT_MS = 15000;

interface MockAccount {
  usernameOrEmail: string;
  password: string;
  user: UserProfile;
}

// Dummy credentials for testing the Login -> Dashboard flow.
// These are intentionally kept working alongside the real
// Liferay login.
//
// Site Engineer:
//   username: john.doe       password: test
//   username: admin          password: Admin@123
//
// Truck Driver:
//   username: gurpreet.singh password: test

export const MOCK_ACCOUNTS: MockAccount[] = [
  {
    usernameOrEmail: 'john.doe',
    password: 'test',
    user: {
      id: 'u-1001',
      firstName: 'John',
      fullName: 'John Mathew',
      role: 'SITE_ENGINEER',
    },
  },
  {
    usernameOrEmail: 'admin',
    password: 'Admin@123',
    user: {
      id: 'u-1002',
      firstName: 'Admin',
      fullName: 'Admin User',
      role: 'SITE_ENGINEER',
    },
  },
  {
    usernameOrEmail: 'gurpreet.singh',
    password: 'test',
    user: {
      id: 'u-2001',
      firstName: 'Gurpreet',
      fullName: 'Gurpreet Singh',
      role: 'TRUCK_DRIVER',
      vehicleNumber: 'MH-31-CB-8842',
      vehicleModel: 'BharatBenz 2823R',
    },
  },
];

// While debugging APK logins, append the roles Liferay actually
// returned to the "no access" message shown on the login screen.
// Set to false once login is confirmed working everywhere.
const SHOW_ROLE_DEBUG_IN_ERROR = true;

/**
 * Builds the login response.
 *
 * Both `accessToken` and `token` are set (plus `refreshToken`)
 * so it works with whichever field name LoginResponse /
 * AppNavigator read.
 */
function buildLoginResponse(args: {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  user: UserProfile;
}): LoginResponse {
  return {
    accessToken: args.accessToken,
    token: args.accessToken,
    refreshToken: args.refreshToken,
    expiresAt: args.expiresAt,
    user: args.user,
  } as unknown as LoginResponse;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function findMockAccount(
  credentials: LoginCredentials,
): MockAccount | undefined {
  return MOCK_ACCOUNTS.find(
    (acc) =>
      acc.usernameOrEmail.toLowerCase() ===
        credentials.usernameOrEmail.trim().toLowerCase() &&
      acc.password === credentials.password,
  );
}

function assertRoleAllowed(
  account: MockAccount,
  expectedRole?: UserRole,
): void {
  if (expectedRole && account.user.role !== expectedRole) {
    const error = new Error('ROLE_MISMATCH');

    (error as any).status = 403;
    (error as any).actualRole = account.user.role;

    throw error;
  }
}

async function mockLogin(
  account: MockAccount,
  expectedRole: UserRole | undefined,
): Promise<LoginResponse> {
  await delay(MOCK_LOGIN_DELAY_MS);

  assertRoleAllowed(account, expectedRole);

  return buildLoginResponse({
    accessToken: `mock-token-${account.user.id}`,
    refreshToken: `mock-refresh-${account.user.id}`,
    expiresAt: new Date(
      Date.now() + 1000 * 60 * 60 * 8,
    ).toISOString(),
    user: account.user,
  });
}

/**
 * Given a Liferay user account's roleBriefs, decide which
 * app UserRole this account is allowed to log in as.
 */
function resolveRoleFromRoleBriefs(
  roleBriefs: Array<{ key: string }>,
): UserRole | undefined {
  const keys = new Set(
    roleBriefs.map((r) => r.key),
  );

  const match = (
    Object.keys(LIFERAY_ROLE_KEYS) as UserRole[]
  ).find(
    (role) => keys.has(LIFERAY_ROLE_KEYS[role]),
  );

  return match;
}

async function realLogin(
  credentials: LoginCredentials,
  expectedRole: UserRole | undefined,
): Promise<LoginResponse> {
  if (!apiClient.isConfigured()) {
    throw new ApiClientNotConfiguredError();
  }

  // Step 1: exchange credentials for an access token.
  const token = await apiClient.getAccessToken(
    credentials.usernameOrEmail.trim(),
    credentials.password,
  );

  // Read the token fields defensively.
  const rawToken = token as any;

  const accessToken: string =
    rawToken.access_token ??
    rawToken.accessToken;

  // Step 2: fetch the full account.
  const account =
    await apiClient.getUserAccountByEmail(
      accessToken,
      credentials.usernameOrEmail.trim(),
    );

  // Step 3: resolve the app role.
  const resolvedRole = await resolveAppRole({
    accessToken,
    account,
    expectedRole,
  });

  if (
    expectedRole &&
    resolvedRole !== expectedRole
  ) {
    const error = new Error('ROLE_MISMATCH');

    (error as any).status = 403;
    (error as any).actualRole = resolvedRole;

    throw error;
  }

  const user: UserProfile = {
    id: String(account.id),
    firstName:
      account.givenName ||
      account.name?.split(' ')[0] ||
      'User',
    familyName: account.familyName,
    fullName:
      account.name ||
      `${account.givenName || ''} ${
        account.familyName || ''
      }`.trim(),
    alternateName: account.alternateName,
    email: account.emailAddress,
    jobTitle: account.jobTitle,
    role: resolvedRole,
    avatarUrl: account.image
      ? `${apiClient.baseUrl}${account.image}`
      : undefined,
    externalReferenceCode:
      account.externalReferenceCode,
    dateCreated: account.dateCreated,
    lastLoginDate: account.lastLoginDate,
    status: account.status,
  };

  const expiresInSec = Number(
    rawToken.expires_in ??
      rawToken.expiresIn ??
      600,
  );

  return buildLoginResponse({
    accessToken,
    refreshToken:
      rawToken.refresh_token ??
      rawToken.refreshToken,
    expiresAt: new Date(
      Date.now() + expiresInSec * 1000,
    ).toISOString(),
    user,
  });
}

/* ============================================================
 * MOBILE OTP AUTHENTICATION
 * ============================================================
 */

export interface SendOtpResponse {
  success: boolean;
  verificationToken?: string;
  expiresIn?: string | number;
  message?: string;
  error?: string;
}

export interface VerifyOtpUser {
  emailAddress: string;
  roles: string[];
  fullName: string;
  screenName: string;
  userId: string;
}

export interface VerifyOtpResponse {
  access_token: string;
  /** Used to renew the session as THIS driver (see api/client.ts renewSessionToken). */
  refresh_token?: string;
  scope?: string;
  token_type: string;
  expires_in: number;
  user: VerifyOtpUser;
}

/**
 * Send OTP to a registered mobile number.
 *
 * Backend:
 * POST /o/mobile-auth/send-otp
 *
 * Request:
 * {
 *   "mobileNumber": "7397714287"
 * }
 */
async function sendOtp(
  mobileNumber: string,
): Promise<SendOtpResponse> {
  if (!apiClient.isConfigured()) {
    throw new ApiClientNotConfiguredError();
  }

  const baseUrl = getBaseUrl();
  let response: Response;

  try {
    response = await fetchWithTimeout(
      `${baseUrl}/o/mobile-auth/send-otp`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          mobileNumber,
        }),
      },
      OTP_REQUEST_TIMEOUT_MS,
    );
  } catch (err) {
    const authErr = toAuthError(err);
    throw new Error(authErr.message);
  }

  let data: SendOtpResponse;

  try {
    data =
      (await response.json()) as SendOtpResponse;
  } catch {
    throw new Error(
      `Send OTP failed with status ${response.status}.`,
    );
  }

  if (!response.ok) {
    throw new Error(
      data.error ||
        data.message ||
        `Send OTP failed with status ${response.status}.`,
    );
  }

  return data;
}

/**
 * Verify OTP.
 *
 * Backend:
 * POST /o/mobile-auth/verify-otp
 *
 * Request:
 * {
 *   "verificationToken": "...",
 *   "otp": "123456"
 * }
 */
async function verifyOtp(
  verificationToken: string,
  otp: string,
): Promise<VerifyOtpResponse> {
  if (!apiClient.isConfigured()) {
    throw new ApiClientNotConfiguredError();
  }

  const baseUrl = getBaseUrl();
  let response: Response;

  try {
    response = await fetchWithTimeout(
      `${baseUrl}/o/mobile-auth/verify-otp`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          verificationToken,
          otp,
        }),
      },
      OTP_REQUEST_TIMEOUT_MS,
    );
  } catch (err) {
    const authErr = toAuthError(err);
    throw new Error(authErr.message);
  }

  let data:
    | VerifyOtpResponse
    | {
        success?: boolean;
        error?: string;
        message?: string;
      };

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `OTP verification failed with status ${response.status}.`,
    );
  }

  if (!response.ok) {
    const errorData = data as {
      success?: boolean;
      error?: string;
      message?: string;
    };

    throw new Error(
      errorData.error ||
        errorData.message ||
        `OTP verification failed with status ${response.status}.`,
    );
  }

  return data as VerifyOtpResponse;
}

const USER_FRIENDLY_MESSAGES: Record<
  AuthError['code'],
  string
> = {
  INVALID_CREDENTIALS:
    'Invalid username or password.',
  ROLE_MISMATCH:
    'These credentials belong to a different role.',
  ACCESS_DENIED:
    "Your account doesn't have access to this app. Contact your administrator.",
  NETWORK_ERROR:
    'Unable to connect. Please check your internet connection.',
  TIMEOUT:
    'The request timed out. Please try again.',
  UNKNOWN:
    'Something went wrong. Please try again.',
};

function toAuthError(err: unknown): AuthError {
  if (err instanceof ApiClientNotConfiguredError) {
    return {
      code: 'UNKNOWN',
      message: USER_FRIENDLY_MESSAGES.UNKNOWN,
      cause: err,
    };
  }

  if (
    err instanceof Error &&
    err.message === 'TIMEOUT'
  ) {
    return {
      code: 'TIMEOUT',
      message: USER_FRIENDLY_MESSAGES.TIMEOUT,
      cause: err,
    };
  }

  if (
    err instanceof Error &&
    err.message === 'ROLE_MISMATCH'
  ) {
    const actualRole =
      (err as any)?.actualRole as
        | UserRole
        | undefined;

    const actualRoleLabel = actualRole
      ? ROLE_LABELS[actualRole]
      : 'a different role';

    return {
      code: 'ROLE_MISMATCH',
      message:
        `These credentials belong to a ${actualRoleLabel} account. ` +
        `Go back and select "${actualRoleLabel}" to log in.`,
      cause: err,
    };
  }

  if (
    err instanceof Error &&
    err.message === 'ACCESS_DENIED'
  ) {
    const detail =
      (err as any)?.detail as string | undefined;

    return {
      code: 'ACCESS_DENIED',
      message:
        USER_FRIENDLY_MESSAGES.ACCESS_DENIED +
        (SHOW_ROLE_DEBUG_IN_ERROR && detail
          ? ` (${detail})`
          : ''),
      cause: err,
    };
  }

  const status = (err as any)?.status;

  if (
    status === 401 ||
    status === 400 ||
    status === 403
  ) {
    return {
      code: 'INVALID_CREDENTIALS',
      message:
        USER_FRIENDLY_MESSAGES.INVALID_CREDENTIALS,
      cause: err,
    };
  }

  if (err instanceof TypeError) {
    return {
      code: 'NETWORK_ERROR',
      message:
        USER_FRIENDLY_MESSAGES.NETWORK_ERROR,
      cause: err,
    };
  }

  if (err instanceof Error) {
    const msg = err.message;

    const networkPatterns = [
      'fetch failed',
      'SSLHandshakeException',
      'CertPathValidatorException',
      'ECONNREFUSED',
      'ENOTFOUND',
      'network request failed',
      'net::',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ECONNRESET',
    ];

    if (
      networkPatterns.some((pattern) =>
        msg.includes(pattern),
      )
    ) {
      return {
        code: 'NETWORK_ERROR',
        message:
          USER_FRIENDLY_MESSAGES.NETWORK_ERROR,
        cause: err,
      };
    }
  }

  return {
    code: 'UNKNOWN',
    message: USER_FRIENDLY_MESSAGES.UNKNOWN,
    cause: err,
  };
}

export const authService = {
  /**
   * Existing username/password login.
   *
   * KEEP THIS for now.
   * We will remove/retire it only after the OTP
   * authentication flow is fully working.
   */
  async login(
    credentials: LoginCredentials,
    expectedRole?: UserRole,
  ): Promise<LoginResult> {
    try {
      const mockAccount =
        findMockAccount(credentials);

      const data = mockAccount
        ? await mockLogin(
            mockAccount,
            expectedRole,
          )
        : await realLogin(
            credentials,
            expectedRole,
          );

      return {
        success: true,
        data,
      };
    } catch (err) {
      const authError = toAuthError(err);

      console.warn(
        '[authService.login] raw error:',
        err instanceof Error
          ? err.message
          : err,
        '\n -> status:',
        (err as any)?.status,
        '\n -> body:',
        JSON.stringify(
          (err as any)?.body,
        ),
        '\n -> mapped to:',
        authError.code,
      );

      return {
        success: false,
        error: authError,
      };
    }
  },

  /**
   * New phone-number authentication.
   */
  sendOtp,

  /**
   * New OTP verification.
   */
  verifyOtp,
};
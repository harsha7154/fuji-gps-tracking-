/**
 * Authentication service.
 *
 * This is the ONLY place that knows how login is performed.
 *
 * Mobile OTP login (the only login method):
 *   1. POST /o/mobile-auth/send-otp      (mobile number -> verificationToken)
 *   2. POST /o/mobile-auth/verify-otp    (verificationToken + otp -> access_token, refresh_token, user)
 *
 * The app role (driver / site engineer) is decided from the roles returned by verify-otp
 * (see AppNavigator). No client id / client secret is used.
 */

import {
  apiClient,
  ApiClientNotConfiguredError,
  fetchWithTimeout,
  getBaseUrl,
} from '../api/client';

import type { AuthError } from '../types/auth';

// send-otp / verify-otp had no timeout, so a stalled connection kept the Login / OTP spinner
// up forever. Same 15 s limit as the other Liferay calls; a timeout surfaces as the existing
// 'The request timed out. Please try again.' message (toAuthError -> TIMEOUT).
const OTP_REQUEST_TIMEOUT_MS = 15000;

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

  if (response.status === 429) {
    let serverMsg: string | undefined;
    try {
      const parsed = await response.json();
      serverMsg = parsed?.error || parsed?.message;
    } catch {
      // not JSON
    }
    throw new Error(
      serverMsg || '429 Too Many Requests: You have reached the maximum attempt limit for OTP requests. Please wait a few minutes before trying again.'
    );
  }

  let data: SendOtpResponse;

  try {
    data = (await response.json()) as SendOtpResponse;
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

  if (response.status === 429) {
    let serverMsg: string | undefined;
    try {
      const parsed = await response.json();
      serverMsg = parsed?.error || parsed?.message;
    } catch {
      // not JSON
    }
    throw new Error(
      serverMsg || '429 Too Many Requests: Too many verification attempts. Please wait a few minutes before trying again.'
    );
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
   * Phone-number authentication: send the OTP.
   */
  sendOtp,

  /**
   * Phone-number authentication: verify the OTP.
   */
  verifyOtp,
};

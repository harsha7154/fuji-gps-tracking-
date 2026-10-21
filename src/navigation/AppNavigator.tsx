import React, { useCallback, useEffect, useRef, useState } from 'react';

import {
  AppState,
  AppStateStatus,
  View,
  Alert,
} from 'react-native';



import { SplashScreen } from '../screens/SplashScreen';

import { LoginScreen } from '../screens/LoginScreen';

import { OtpScreen } from '../screens/OtpScreen';

import { DashboardScreen } from '../screens/DashboardScreen';

import { DriverDashboardScreen } from '../screens/DriverDashboardScreen';

import { EngineerProfileScreen } from '../screens/EngineerProfileScreen';

import { DriverProfileScreen } from '../screens/DriverProfileScreen';



import {

  ProductSelectionScreen,

  Product,

} from '../screens/ProductSelectionScreen';



import SiteScreen, {

  Site,

} from '../screens/SiteScreen';



import ActivityScreen, {

  Activity,

  Checkpoint,

} from '../screens/ActivityScreen';



import DailyProgressScreen from '../screens/DailyProgressScreen';



import CameraCaptureScreen, {

  CapturedPhoto,

} from '../screens/CameraCaptureScreenX';



import WatermarkPreviewScreen from '../screens/WatermarkPreviewScreen';



import SubmissionSuccessScreen from '../screens/SubmissionSuccessScreen';



import { NotificationsScreen } from '../screens/NotificationsScreen';

import { DriverGpsTrackingScreen } from '../screens/DriverGpsTrackingScreen';

import { GlobalArrivalPrompt } from '../components/GlobalArrivalPrompt';
import { BackgroundGpsController } from '../components/BackgroundGpsController';
import { stopBackgroundGpsTracking } from '../tasks/backgroundGpsTask';
import { registerForPush, unregisterFromPush, watchPushTokenChanges } from '../services/pushRegistration';
import { promptBatteryOptimizationOnce, promptNotificationSettingsOnce } from '../utils/backgroundPermissions';

import { DriverPodScreen } from '../screens/DriverPodScreen';

import { DriverPodSuccessScreen } from '../screens/DriverPodSuccessScreen';

import { MyTripScreen } from '../screens/MyTripScreen';

import { DriverTripHistoryScreen } from '../screens/DriverTripHistoryScreen';



import { driverWorkflowService } from '../services/driverWorkflowService';
import { driverPodService } from '../services/driverPodService';

import { checkForNewNotifications } from '../services/notificationWatcher';

import {

  ensureNotificationPermission,

  onSystemNotificationTapped,

  presentSystemNotifications,

  setAppBadgeCount,

} from '../services/systemNotifications';

import {

  registerBackgroundNotificationCheck,

  unregisterBackgroundNotificationCheck,

} from '../tasks/backgroundNotificationTask';

import {

  NotificationToast,

  NotificationToastData,

} from '../components/NotificationToast';

import {

  getNotificationText,

  getNotificationTitle,

} from '../utils/notificationContent';



import { apiClient, isRefreshRejected, SessionExpiredError } from '../api/client';
import { subscribeSessionExpired } from '../services/sessionTokenService';
import { authService } from '../services/authService';
import { arrivalConfirmationService } from '../services/arrivalConfirmationService';


import {

  getAuthSession,

  saveAuthSession,

  clearAuthSession,

} from '../services/sessionStorage';



import type {

  UserProfile,

  UserRole,

} from '../types/auth';



import type {

  BottomTabKey,

} from '../components/BottomTabBar';



import type {

  PodSubmissionResult,

  PodTripSummary,

} from '../types/driverWorkflow';





type AppRoute =

  | 'Splash'

  | 'Login'

  | 'Otp'

  | 'Dashboard'

  | 'DriverDashboard'

  | 'EngineerProfile'

  | 'DriverProfile'

  | 'ProductSelection'

  | 'SiteSelection'

  | 'Activity'

  | 'DailyProgress'

  | 'Camera'

  | 'UpdateProgress'

  | 'WatermarkPreview'

  | 'SubmissionSuccess'

  | 'DriverNotifications'

  | 'DriverGpsTracking'

  | 'DriverMyTrip'

  | 'DriverTripHistory'

  | 'DriverPod'

  | 'DriverCamera'

  | 'DriverPodSuccess';





export const AppNavigator: React.FC = () => {



  const [route, setRoute] =

    useState<AppRoute>('Splash');

  const [isRestoringSession, setIsRestoringSession] = useState(true);



  // ============================================================

  // AUTHENTICATION STATE

  // ============================================================



  const [currentUser, setCurrentUser] =

    useState<UserProfile | null>(null);



  const [accessToken, setAccessToken] =

    useState<string | null>(null);



  const [refreshToken, setRefreshToken] =

    useState<string | null>(null);



  const [expiresAt, setExpiresAt] =

    useState<string | null>(null);
  // Bumped after a failed (but not refused) renewal so the timer below tries again.
  const [renewAttempt, setRenewAttempt] = useState(0);



  const [selectedRole, setSelectedRole] =

    useState<UserRole | null>(null);



  // Phone number temporarily held while the user verifies OTP.
  // Phone number temporarily held while the user verifies OTP.
  const [otpPhoneNumber, setOtpPhoneNumber] =
    useState('');

  // Verification token returned by the backend when OTP is sent.
  // This is required by /verify-otp.
  const [otpVerificationToken, setOtpVerificationToken] =
    useState('');





  const [selectedProduct, setSelectedProduct] =

    useState<Product | null>(null);



  const [selectedSite, setSelectedSite] =

    useState<Site | null>(null);



  const [selectedActivity, setSelectedActivity] =

    useState<Activity | null>(null);



  const [selectedCheckpoint, setSelectedCheckpoint] =

    useState<Checkpoint | null>(null);



  const [capturedPhotos, setCapturedPhotos] =

    useState<CapturedPhoto[]>([]);



  const [progressNotes, setProgressNotes] =

    useState('');





  // ============================================================

  // TRUCK DRIVER — POD FLOW STATE

  // ============================================================



  const [driverCapturedPhotos, setDriverCapturedPhotos] =

    useState<CapturedPhoto[]>([]);



  const [driverPodTripSummary, setDriverPodTripSummary] =

    useState<PodTripSummary | null>(null);



  const [driverPodSubmission, setDriverPodSubmission] =

    useState<PodSubmissionResult | null>(null);



  // Dispatch the driver opened Live GPS for (undefined => tracking screen picks the In Transit one).

  const [selectedDispatchId, setSelectedDispatchId] =

    useState<string | undefined>(undefined);

  const [selectedObjectEntryId, setSelectedObjectEntryId] =
    useState<number | string | undefined>(undefined);

  const [recentlyArrivedDispatchId, setRecentlyArrivedDispatchId] =
    useState<string | undefined>(undefined);



  // Unread Liferay notifications — shown as the bell badge on every driver screen.

  const [notificationCount, setNotificationCount] =

    useState<number>(0);





  // ============================================================

  // RESTORE SAVED AUTH SESSION

  // ============================================================



  // ============================================================
  // RESTORE SAVED AUTH SESSION
  // ============================================================

  useEffect(() => {
    let cancelled = false;

    const restoreSession = async () => {
      console.log(
        '[AppNavigator] Checking for saved auth session...'
      );

      try {
        const savedSession = await getAuthSession();

        if (!savedSession) {
          console.log(
            '[AppNavigator] No saved auth session found.'
          );

          return;
        }

        let currentAccessToken = savedSession.accessToken;
        let currentRefreshToken = savedSession.refreshToken ?? null;
        let currentExpiresAt = savedSession.expiresAt;

        const expiresAtMs = currentExpiresAt ? new Date(currentExpiresAt).getTime() : NaN;
        const isNearOrExpired = !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + 60_000;

        if (isNearOrExpired) {
          console.log(
            '[AppNavigator] Saved session token is near or past expiry — renewing via supported backend flow...'
          );
          try {
            const renewed = await apiClient.renewSessionToken(currentRefreshToken ?? undefined);
            if (cancelled) return;

            currentAccessToken = renewed.access_token;
            currentRefreshToken = renewed.refresh_token ?? renewed.refreshToken ?? currentRefreshToken;
            currentExpiresAt = apiClient.computeExpiresAt(renewed);

            await saveAuthSession({
              accessToken: currentAccessToken,
              refreshToken: currentRefreshToken ?? undefined,
              expiresAt: currentExpiresAt,
              user: savedSession.user,
            });

            console.log('[AppNavigator] Saved session renewed successfully on restore.');
          } catch (renewError) {
            console.warn('[AppNavigator] Token renewal during restore encountered error:', renewError);
            const isNetError =
              renewError instanceof Error &&
              (renewError.message.includes('fetch') ||
                renewError.message.includes('network') ||
                renewError.message.includes('TIMEOUT'));

            console.warn('[auth] restore: renewal failed', {
              refused: isRefreshRejected(renewError),
              network: isNetError,
              tokenAlreadyExpired: Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now(),
            });

            // Only a refresh the server REFUSED (or a session with no refresh token) ends the login.
            // A server hiccup / no network keeps the user signed in; renewal is retried while the app runs.
            if (isRefreshRejected(renewError) && Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now()) {
              console.warn('[auth] LOGOUT on app start: saved token expired and could not be renewed:', renewError);
              await clearAuthSession();

              if (!cancelled) {
                setCurrentUser(null);
                setAccessToken(null);
                setRefreshToken(null);
                setExpiresAt(null);
                setSelectedRole(null);
                setRoute('Login');
                Alert.alert('Session Expired', 'Your session has expired. Please log in again to continue.');
              }
              return;
            }
          }
        }

        if (cancelled) return;

        setCurrentUser(savedSession.user);
        setAccessToken(currentAccessToken);
        setRefreshToken(currentRefreshToken);
        setExpiresAt(currentExpiresAt);
        setSelectedRole(null);

        if (savedSession.user.role === 'TRUCK_DRIVER') {
          setRoute('DriverDashboard');
        } else {
          setRoute('Dashboard');
        }

        console.log('[AppNavigator] Auth session restored successfully:', {
          userId: savedSession.user.id,
          role: savedSession.user.role,
          hasAccessToken: !!currentAccessToken,
          expiresAt: currentExpiresAt,
        });
      } catch (error) {
        console.error(
          '[auth] LOGOUT on app start: restoring the saved session threw an error:',
          error
        );

        await clearAuthSession();

        if (!cancelled) {
          setCurrentUser(null);
          setAccessToken(null);
          setRefreshToken(null);
          setExpiresAt(null);
          setSelectedRole(null);
          setRoute('Login');
        }
      } finally {
        if (!cancelled) {
          setIsRestoringSession(false);
        }
      }
    };

    restoreSession();

    return () => {
      cancelled = true;
    };
  }, []);



  // ============================================================

  // UNIFIED BOTTOM TAB HANDLER — used by ALL screens

  // ============================================================



  const handleBottomTab = useCallback(

    (tab: BottomTabKey) => {

      console.log(

        '[AppNavigator] Bottom tab pressed:',

        tab

      );



      switch (tab) {



        case 'home':

          setRoute(

            currentUser?.role === 'TRUCK_DRIVER'

              ? 'DriverDashboard'

              : 'Dashboard'

          );

          break;



        case 'sites':

          setRoute('ProductSelection');

          break;



        case 'activities':

          setRoute('Activity');

          break;



        case 'notifications':
          setRoute('DriverNotifications');
          break;



        case 'more':

          if (

            currentUser?.role ===

            'TRUCK_DRIVER'

          ) {

            setRoute('DriverProfile');

          } else {

            setRoute('EngineerProfile');

          }

          break;



        default:

          break;

      }

    },

    [currentUser]

  );





  // ============================================================

  // ROLE / LOGIN

  // ============================================================



  const handleSelectRole = useCallback(

    (role: UserRole) => {

      setSelectedRole(role);

      setRoute('Login');

    },

    []

  );





  // Splash finished (5 s) -> Login. The role comes from Liferay at login.

  const goToLogin = useCallback(

    () => {

      setSelectedRole(null);

      setRoute('Login');

    },

    []

  );





  const handleLoginBack = useCallback(

    () => {

      setSelectedRole(null);

      setRoute('Splash');

    },

    []

  );


  // ============================================================
  // PHONE + OTP LOGIN
  // ============================================================

  const handleSendOtp = useCallback(
    async (phoneNumber: string) => {
      console.log(
        '[AppNavigator] Sending OTP for:',
        phoneNumber
      );

      try {
        const response =
          await authService.sendOtp(phoneNumber);

        console.log(
          '[AppNavigator] Send OTP response:',
          {
            success: response.success,
            hasVerificationToken:
              !!response.verificationToken,
            expiresIn: response.expiresIn,
          }
        );

        if (
          !response.success ||
          !response.verificationToken
        ) {
          Alert.alert(
            'Unable to Send OTP',
            response.error ||
            response.message ||
            'Unable to send OTP. Please try again.'
          );

          return;
        }

        // Store the phone number and temporary
        // verification token for the OTP screen.
        setOtpPhoneNumber(phoneNumber);
        setOtpVerificationToken(
          response.verificationToken
        );

        console.log(
          '[AppNavigator] OTP sent successfully. Opening OTP screen.'
        );

        setRoute('Otp');
      } catch (error) {
        console.error(
          '[AppNavigator] Send OTP failed:',
          error
        );

        Alert.alert(
          'Unable to Send OTP',
          error instanceof Error
            ? error.message
            : 'Unable to send OTP. Please try again.'
        );
      }
    },
    []
  );

  const handleResendOtp = useCallback(
    async (): Promise<boolean> => {
      console.log(
        '[AppNavigator] Resending OTP for:',
        otpPhoneNumber
      );

      if (!otpPhoneNumber) {
        console.error(
          '[AppNavigator] Cannot resend OTP — phone number is missing.'
        );

        return false;
      }

      try {
        const response =
          await authService.sendOtp(otpPhoneNumber);

        console.log(
          '[AppNavigator] Resend OTP response:',
          {
            success: response.success,
            hasVerificationToken:
              !!response.verificationToken,
            expiresIn: response.expiresIn,
          }
        );

        if (
          !response.success ||
          !response.verificationToken
        ) {
          Alert.alert(
            'Unable to Resend OTP',
            response.error ||
            response.message ||
            'Unable to resend OTP. Please try again.'
          );

          return false;
        }

        // IMPORTANT:
        // Replace the old verification token with
        // the new token returned by the backend.
        setOtpVerificationToken(
          response.verificationToken
        );

        console.log(
          '[AppNavigator] New OTP verification token stored.'
        );

        return true;
      } catch (error) {
        console.error(
          '[AppNavigator] Resend OTP failed:',
          error
        );

        Alert.alert(
          'Unable to Resend OTP',
          error instanceof Error
            ? error.message
            : 'Unable to resend OTP. Please try again.'
        );

        return false;
      }
    },
    [otpPhoneNumber]
  );

  const handleChangePhone = useCallback(() => {
    setOtpPhoneNumber('');
    setOtpVerificationToken('');
    setRoute('Login');
  }, []);

  const handleVerifyOtp = useCallback(
    async (otp: string) => {
      console.log('[AppNavigator] Verifying OTP...');

      if (!otpVerificationToken) {
        Alert.alert(
          'Verification Error',
          'OTP verification session has expired. Please request a new OTP.'
        );

        setOtpPhoneNumber('');
        setOtpVerificationToken('');
        setRoute('Login');

        return;
      }

      try {
        const response = await authService.verifyOtp(
          otpVerificationToken,
          otp
        );

        console.log(
          '[AppNavigator] OTP verification successful:',
          {
            userId: response.user?.userId,
            roles: response.user?.roles,
            expiresIn: response.expires_in,
            hasAccessToken: !!response.access_token,
          }
        );

        // ------------------------------------------------------------
        // Resolve the application role from backend roles
        // ------------------------------------------------------------

        const backendRoles = (
          response.user?.roles ?? []
        ).map((role) =>
          role.trim().toLowerCase()
        );

        let appRole: UserRole | null = null;

        if (
          backendRoles.some(
            (role) =>
              role === 'driver' ||
              role.includes('driver')
          )
        ) {
          appRole = 'TRUCK_DRIVER';
        } else if (
          backendRoles.some(
            (role) =>
              role === 'site engineer' ||
              role.includes('site engineer')
          )
        ) {
          appRole = 'SITE_ENGINEER';
        }

        if (!appRole) {
          console.error(
            '[AppNavigator] Unsupported backend role:',
            response.user?.roles
          );

          Alert.alert(
            'Access Denied',
            'Your account does not have access to this application.'
          );

          return;
        }

        // ------------------------------------------------------------
        // Build the app user profile
        // ------------------------------------------------------------

        if (!response.user) {
          Alert.alert(
            'Login Failed',
            'User information was not returned by the server.'
          );
          return;
        }

        const fullName =
          response.user.fullName?.trim() ||
          response.user.screenName ||
          'User';

        const firstName =
          fullName.split(/\s+/)[0] || 'User';

        const user: UserProfile = {
          id: String(response.user.userId),
          firstName,
          fullName,
          alternateName: response.user.screenName,
          email: response.user.emailAddress,
          role: appRole,
        };

        // ------------------------------------------------------------
        // Calculate exact access-token expiry time
        // Backend gives expires_in in seconds.
        // ------------------------------------------------------------

        const expiresAt = new Date(
          Date.now() +
          Number(response.expires_in) * 1000
        ).toISOString();

        // ------------------------------------------------------------
        // Update in-memory authentication state
        // OTP login returns a refresh token; it is kept so the session renews as THIS driver.
        // ------------------------------------------------------------

        setCurrentUser(user);
        setAccessToken(response.access_token);
        setRefreshToken(response.refresh_token ?? null);
        setExpiresAt(expiresAt);
        console.log(
          '[AppNavigator] OTP login: refresh token',
          response.refresh_token ? 'received - session can be renewed as this driver' : 'NOT returned by the backend - session cannot be renewed'
        );
        setSelectedRole(null);

        // ------------------------------------------------------------
        // Persist session securely
        // refreshToken is saved too (read back by sessionTokenService / renewals).
        // ------------------------------------------------------------

        await saveAuthSession({
          accessToken: response.access_token,
          refreshToken: response.refresh_token,
          expiresAt,
          user,
        });

        console.log(
          '[AppNavigator] OTP auth session saved securely'
        );

        // Clear temporary OTP information.
        setOtpPhoneNumber('');
        setOtpVerificationToken('');

        // ------------------------------------------------------------
        // Navigate according to backend role
        // ------------------------------------------------------------

        if (appRole === 'TRUCK_DRIVER') {
          setRoute('DriverDashboard');
        } else {
          setRoute('Dashboard');
        }
      } catch (error) {
        console.error(
          '[AppNavigator] OTP verification failed:',
          error
        );

        Alert.alert(
          'OTP Verification Failed',
          error instanceof Error
            ? error.message
            : 'Invalid OTP. Please try again.'
        );
      }
    },
    [otpVerificationToken]
  );

  // ============================================================
  // SESSION EXPIRED
  // ============================================================

  const handleSessionExpired = useCallback(async () => {
    console.warn(
      '[auth] LOGOUT: session ended, returning to login. The reason is in the [auth] / [session] lines just above.',
    );

    await clearAuthSession();

    setCurrentUser(null);
    setAccessToken(null);
    setRefreshToken(null);
    setExpiresAt(null);
    setSelectedRole(null);

    setOtpPhoneNumber('');
    setOtpVerificationToken('');

    const why = apiClient.getLastAuthFailure();
    Alert.alert(
      'Session Expired',
      'Your session has expired. Please log in again to continue.' +
        (why ? `\n\n(reason: ${why})` : '')
    );

    setRoute('Login');
  }, []);

  // Background services (sessionTokenService) tell us when the session can no longer be renewed.
  useEffect(() => subscribeSessionExpired(() => { handleSessionExpired(); }), [handleSessionExpired]);

  // ============================================================
  // TOKEN REFRESH
  // ============================================================

  const handleTokenRefresh = useCallback(
    async (
      newAccessToken: string,
      newRefreshToken: string,
      newExpiresAt: string,
    ) => {
      console.log(
        '[AppNavigator] Access token refreshed — updating auth state'
      );

      setAccessToken(newAccessToken);
      setRefreshToken(newRefreshToken);
      setExpiresAt(newExpiresAt);

      if (currentUser) {
        try {
          await saveAuthSession({
            accessToken: newAccessToken,
            refreshToken: newRefreshToken,
            expiresAt: newExpiresAt,
            user: currentUser,
          });

          console.log(
            '[AppNavigator] Refreshed session saved securely'
          );
        } catch (error) {
          console.error(
            '[AppNavigator] Failed to save refreshed session:',
            error
          );
        }
      }
    },
    [currentUser]
  );

  // ============================================================
  // NOTIFICATIONS — badge, in-app toast, system notifications
  // ============================================================
  //
  // App open:   every 30 s (and on every screen change) check for new
  //             notifications -> update the bell badge + show the in-app toast.
  // App closed: the background task (tasks/backgroundNotificationTask.ts)
  //             checks every ~15 min and raises system notifications.

  const [notificationToast, setNotificationToast] =
    useState<NotificationToastData | null>(null);

  // Refs so the checker never needs to be re-created when tokens rotate.
  const notificationAuthRef = useRef<{
    userId: string | null;
    accessToken: string | null;
    refreshToken: string | null;
    expiresAt: string | null;
    onTokenRefresh: typeof handleTokenRefresh;
    onSessionExpired: typeof handleSessionExpired;
  }>({
    userId: currentUser?.id ?? null,
    accessToken,
    refreshToken,
    expiresAt,
    onTokenRefresh: handleTokenRefresh,
    onSessionExpired: handleSessionExpired,
  });

  useEffect(() => {
    notificationAuthRef.current = {
      userId: currentUser?.id ?? null,
      accessToken,
      refreshToken,
      expiresAt,
      onTokenRefresh: handleTokenRefresh,
      onSessionExpired: handleSessionExpired,
    };
  }, [currentUser, accessToken, refreshToken, expiresAt, handleTokenRefresh, handleSessionExpired]);

  const routeRef = useRef<AppRoute>(route);
  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const lastNotificationCheckRef = useRef<number>(0);
  const consecutive401Ref = useRef<number>(0);
  const backoffUntilRef = useRef<number>(0);

  const refreshNotificationCount =
    useCallback(async (force = false) => {
      const now = Date.now();

      // Circuit breaker: back off if server repeatedly returned 401
      if (now < backoffUntilRef.current) {
        return;
      }

      if (!force && now - lastNotificationCheckRef.current < 20_000) {
        return;
      }

      lastNotificationCheckRef.current = now;

      const auth = notificationAuthRef.current;

      // Only the access token is required; the refresh token is optional.
      if (!auth.accessToken || !auth.userId) {
        return;
      }

      try {
        const { newItems, unreadCount } =
          await checkForNewNotifications({
            userId: auth.userId,
            accessToken: auth.accessToken,
            refreshToken: auth.refreshToken ?? '',
            onTokenRefresh: auth.onTokenRefresh,
          });

        // Reset 401 circuit breaker on success
        consecutive401Ref.current = 0;
        backoffUntilRef.current = 0;

        setNotificationCount(unreadCount);
        setAppBadgeCount(unreadCount);

        if (newItems.length === 0) {
          return;
        }

        if (appStateRef.current === 'active') {
          // In-app toast — not needed while the list itself is on screen.
          if (routeRef.current !== 'DriverNotifications') {
            const latest = newItems[0];
            setNotificationToast({
              key: `${latest.id}-${Date.now()}`,
              title: getNotificationTitle(latest),
              message: getNotificationText(latest),
              count: newItems.length,
            });
          }
        } else {
          // App went to the background between checks: use the system tray.
          presentSystemNotifications(newItems);
        }
      } catch (error: any) {

        // If error is 401, apply exponential backoff circuit breaker to prevent infinite hammering
        if (error?.status === 401 || (error instanceof Error && error.message.includes('401'))) {
          consecutive401Ref.current += 1;
          const count = consecutive401Ref.current;
          // Exponential backoff:
          // 1 failure -> 30s
          // 2 failures -> 60s
          // 3 failures -> 120s
          // 4+ failures -> 300s (5 minutes)
          const backoffMs = Math.min(300_000, 30_000 * Math.pow(2, count - 1));
          backoffUntilRef.current = Date.now() + backoffMs;
          console.warn(
            `[AppNavigator] Notification endpoint returned 401 (${count}x). Backing off for ${Math.round(backoffMs / 1000)}s to prevent server hammering.`,
          );
          return;
        }

        // Keep the last known count; try again on the next tick.
        console.warn(
          '[AppNavigator] Notification check failed:',
          error
        );
      }
    }, []);



  const isSignedIn =

    Boolean(currentUser && accessToken);



  // Re-check on screen change (throttled to max once per 20s)…

  useEffect(() => {

    if (!isSignedIn) {

      return;

    }



    refreshNotificationCount(false);

  }, [route, isSignedIn, refreshNotificationCount]);



  // …and every 30 s while signed in.

  useEffect(() => {

    if (!isSignedIn) {

      return;

    }



    const timer =

      setInterval(

        () => {
          // No point polling while the app is in the background (the background task covers that).
          if (appStateRef.current === 'active') refreshNotificationCount(true);
        },

        30 * 1000

      );



    return () => clearInterval(timer);

  }, [isSignedIn, refreshNotificationCount]);



  // Signed in: ask for notification permission + start the background check.

  useEffect(() => {

    if (!isSignedIn) {

      return;

    }



    ensureNotificationPermission().then(async (granted) => {
      console.log('[AppNavigator] System notification permission:', granted);
      // Refused for good? Explain how to switch it back on (once per launch).
      if (!granted) await promptNotificationSettingsOnce();
      // Drivers only: explain the battery exemption now, so pushes and tracking survive a closed app.
      if (currentUser?.role === 'TRUCK_DRIVER') await promptBatteryOptimizationOnce({ wait: true });
    });



    registerBackgroundNotificationCheck();

  }, [isSignedIn]);

  // FCM push: register this phone with the push relay while signed in, and keep it up to date.
  const pushAuthRef = useRef<{ userId: string; accessToken: string } | null>(null);
  pushAuthRef.current = isSignedIn && currentUser?.id && accessToken ? { userId: String(currentUser.id), accessToken } : null;

  useEffect(() => {
    if (!isSignedIn) return;
    const auth = pushAuthRef.current;
    if (auth) registerForPush(auth);
    return watchPushTokenChanges(() => pushAuthRef.current);
  }, [isSignedIn]);



  // App back in the foreground: pick up tokens the background task may have

  // refreshed, then check for new notifications right away.

  useEffect(() => {

    const subscription =

      AppState.addEventListener('change', async (nextState) => {

        const wasBackground =

          appStateRef.current !== 'active';

        appStateRef.current = nextState;



        if (nextState !== 'active' || !wasBackground) {

          return;

        }



        try {

          const saved = await getAuthSession();

          const auth = notificationAuthRef.current;



          if (

            saved &&

            auth.userId &&

            saved.user.id === auth.userId &&

            saved.accessToken !== auth.accessToken

          ) {

            setAccessToken(saved.accessToken);

            setRefreshToken(saved.refreshToken ?? null);

            setExpiresAt(saved.expiresAt);

            notificationAuthRef.current = {

              ...auth,

              accessToken: saved.accessToken,

              refreshToken: saved.refreshToken ?? null,

            };

          }

        } catch {

          // keep current tokens

        }



        refreshNotificationCount();

      });



    return () => subscription.remove();

  }, [refreshNotificationCount]);



  // Tapping a system notification (or the toast) opens the Notifications screen.

  const openNotificationsScreen =

    useCallback(() => {

      setNotificationToast(null);



      if (notificationAuthRef.current.accessToken) {

        setRoute('DriverNotifications');

      }

    }, []);



  useEffect(() => {

    if (!isSignedIn) {

      return;

    }



    return onSystemNotificationTapped(

      openNotificationsScreen

    );

  }, [isSignedIn, openNotificationsScreen]);



  const dismissNotificationToast =

    useCallback(() => {

      setNotificationToast(null);

    }, []);











  // ============================================================

  // LOGIN SUCCESS

  // ============================================================



  const handleLoginSuccess = useCallback(

    async (

      user: UserProfile,

      accessToken: string,

      refreshToken?: string,

      expiresAt?: string

    ) => {



      console.log(

        '[AppNavigator] Login successful — userId:',

        user.id,

        'hasToken:',

        !!accessToken,

        'hasRefreshToken:',

        !!refreshToken,

        'hasExpiresAt:',

        !!expiresAt

      );



      setCurrentUser(user);

      setAccessToken(accessToken);

      setRefreshToken(refreshToken ?? null);

      setExpiresAt(expiresAt ?? null);

      setSelectedRole(null);



      // Save session only when we have everything

      // required for persistent authentication.

      if (expiresAt) {
        try {
          await saveAuthSession({
            accessToken,
            ...(refreshToken
              ? { refreshToken }
              : {}),
            expiresAt,
            user,
          });

          console.log(
            '[AppNavigator] Auth session saved securely'
          );
        } catch (error) {
          console.error(
            '[AppNavigator] Failed to save auth session:',
            error
          );
        }
      }



      if (

        user.role === 'TRUCK_DRIVER'

      ) {

        setRoute('DriverDashboard');

      } else {

        setRoute('Dashboard');

      }

    },

    []

  );





  // ============================================================

  // PROACTIVE ACCESS TOKEN REFRESH

  // ============================================================



  useEffect(() => {
    if (!accessToken || !expiresAt) {
      return;
    }

    const expiresAtMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresAtMs)) {
      return;
    }

    const now = Date.now();
    // Proactively renew 60 seconds before expiry.
    const refreshLeadTime = 60 * 1000;
    let delay = expiresAtMs - now - refreshLeadTime;

    // Prevent immediate infinite refresh loops, but renew quickly if close to expiry
    if (delay < 5000) {
      delay = Math.max(1000, Math.min(5000, expiresAtMs - now));
    }
    if (expiresAtMs - now <= 0) {
      delay = 15000; // already expired and renewal keeps failing: retry every 15 s, not every second
    }

    console.log(
      '[AppNavigator] Proactive session token renewal scheduled in:',
      Math.round(delay / 1000),
      'seconds'
    );

    const timer = setTimeout(async () => {
      try {
        console.log(
          '[AppNavigator] Access token nearing expiry — renewing via supported backend flow...'
        );

        const refreshed = await apiClient.renewSessionToken(refreshToken ?? undefined);

        const newRefreshToken =
          refreshed.refresh_token ?? refreshed.refreshToken ?? refreshToken;

        const newExpiresAt = apiClient.computeExpiresAt(refreshed);

        console.log('[AppNavigator] Proactive token renewal successful:', {
          hasAccessToken: !!refreshed.access_token,
          expiresIn: refreshed.expires_in,
          newExpiresAt,
        });

        setAccessToken(refreshed.access_token);
        setRefreshToken(newRefreshToken);
        setExpiresAt(newExpiresAt);

        if (currentUser) {
          await saveAuthSession({
            accessToken: refreshed.access_token,
            refreshToken: newRefreshToken ?? undefined,
            expiresAt: newExpiresAt,
            user: currentUser,
          });
        }
      } catch (error) {
        console.error('[AppNavigator] Proactive token renewal failed:', error);
        if (isRefreshRejected(error)) {
          // The server refused the refresh token (or there is none): the session cannot continue.
          await handleSessionExpired(); // shows the "Session Expired" alert with the reason
        } else {
          // Network / server hiccup: stay signed in and try again shortly.
          console.warn('[auth] renewal will be retried (the server did not refuse the refresh token)');
          setRenewAttempt((n) => n + 1);
        }
      }
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [
    accessToken,
    refreshToken,
    expiresAt,
    currentUser,
    renewAttempt,
    handleSessionExpired,
  ]);


  // ============================================================

  // LOGOUT

  // ============================================================



  const handleLogout =

    useCallback(async () => {



      console.log(

        '[AppNavigator] Logging out...'

      );



      await unregisterFromPush(pushAuthRef.current); // clear the FCM token on Liferay (needs the token, so before the session is cleared)
      apiClient.resetRenewalState();

      try {



        await clearAuthSession();



        console.log(

          '[AppNavigator] Saved auth session cleared'

        );



      } catch (error) {



        console.error(

          '[AppNavigator] Failed to clear saved auth session:',

          error

        );

      }



      setCurrentUser(null);

      setAccessToken(null);

      setRefreshToken(null);

      setExpiresAt(null);

      setSelectedRole(null);



      setSelectedProduct(null);

      setSelectedSite(null);

      setSelectedDispatchId(undefined);

      setSelectedObjectEntryId(undefined);

      setRecentlyArrivedDispatchId(undefined);

      setNotificationCount(0);

      setNotificationToast(null);

      setAppBadgeCount(0);

      unregisterBackgroundNotificationCheck();
      stopBackgroundGpsTracking('logout');



      setRoute('Splash');



    }, []);





  // ============================================================

  // NAVIGATION HANDLERS

  // ============================================================



  const goToActivity =

    useCallback(

      () => setRoute('Activity'),

      []

    );



  const goToDashboard =

    useCallback(

      () =>

        setRoute(

          currentUser?.role ===

            'TRUCK_DRIVER'

            ? 'DriverDashboard'

            : 'Dashboard'

        ),

      [currentUser]

    );



  const goToEngineerProfile =

    useCallback(

      () => setRoute('EngineerProfile'),

      []

    );



  const goToDriverProfile =

    useCallback(

      () => setRoute('DriverProfile'),

      []

    );





  const handleBackToDashboardFromProfile =

    useCallback(

      () => {

        setRoute(

          currentUser?.role ===

            'TRUCK_DRIVER'

            ? 'DriverDashboard'

            : 'Dashboard'

        );

      },

      [currentUser]

    );





  // ============================================================

  // PRODUCT + SITE FLOW

  // ============================================================



  const goToProductSelection =

    useCallback(

      () =>

        setRoute('ProductSelection'),

      []

    );



  const handleProductSelect =

    useCallback(

      (product: Product) => {

        setSelectedProduct(product);

        setSelectedSite(null);

        setRoute('SiteSelection');

      },

      []

    );



  const handleSiteSelect =

    useCallback(

      (site: Site) => {

        setSelectedSite(site);

        setRoute('Activity');

      },

      []

    );



  const handleBackFromProductSelection =

    useCallback(

      () => setRoute('Dashboard'),

      []

    );



  const handleBackFromSiteSelection =

    useCallback(

      () => setRoute('ProductSelection'),

      []

    );





  // ============================================================

  // ACTIVITY HANDLERS

  // ============================================================



  const handleSelectActivityOnly =

    useCallback(

      (activity: Activity) => {

        console.log(

          '[AppNavigator] Activity selected (no nav):',

          activity.code

        );

      },

      []

    );



  const handleLogDailyProgress =

    useCallback(

      (

        activity: Activity,

        checkpoint?: Checkpoint

      ) => {

        setSelectedActivity(activity);

        setSelectedCheckpoint(

          checkpoint ?? null);

        setRoute('DailyProgress');

      },

      []

    );





  // ============================================================

  // CAMERA

  // ============================================================



  const handleTakePhoto =

    useCallback(

      () => setRoute('Camera'),

      []

    );



  const handleDeletePhoto =

    useCallback(

      (id: string) => {

        setCapturedPhotos(

          (prev) =>

            prev.filter(

              (p) => p.id !== id

            )

        );

      },

      []

    );



  const handlePhotoCaptured =

    useCallback(

      (photo: CapturedPhoto) => {

        setCapturedPhotos(

          (prev) => [

            ...prev,

            photo,

          ]

        );



        setRoute('DailyProgress');

      },

      []

    );





  // ============================================================

  // DAILY PROGRESS

  // ============================================================



  const handleDailyProgressBack =

    useCallback(

      () => setRoute('Activity'),

      []

    );



  const handleDailyProgressProceed =

    useCallback(

      () => {

        setRoute('SubmissionSuccess');

      },

      []

    );





  // ============================================================

  // WATERMARK

  // ============================================================



  const handleWatermarkBack =

    useCallback(

      () => setRoute('DailyProgress'),

      []

    );



  const handleWatermarkSubmit =

    useCallback(

      () => setRoute('SubmissionSuccess'),

      []

    );





  // ============================================================

  // SUBMISSION

  // ============================================================



  const handleSubmissionLogAnother =

    useCallback(

      () => {

        setSelectedActivity(null);

        setSelectedCheckpoint(null);

        setCapturedPhotos([]);

        setProgressNotes('');

        setRoute('Activity');

      },

      []

    );



  const handleSubmissionBackToDashboard =

    useCallback(

      () => {

        setRoute(

          currentUser?.role ===

            'TRUCK_DRIVER'

            ? 'DriverDashboard'

            : 'Dashboard'

        );

      },

      [currentUser]

    );





  // ============================================================

  // TRUCK DRIVER — NOTIFICATIONS / GPS / POD

  // ============================================================



  const goToDriverNotifications =

    useCallback(

      () => setRoute('DriverNotifications'),

      []

    );



  const goToDriverGpsTracking =
    useCallback(
      (dispatchId?: string, entryId?: number | string) => {
        // Guard: some callers may pass a press event instead of an id.
        const validId = typeof dispatchId === 'string' ? dispatchId : undefined;
        const validEntryId =
          typeof entryId === 'number' || typeof entryId === 'string' ? entryId : undefined;
        console.log('[AppNavigator] Immediately before goToDriverGpsTracking navigation decision:', {
          dispatchId: validId,
          objectEntryId: validEntryId,
          currentRoute: route,
          navigationDecision: 'Navigating to DriverGpsTracking screen',
        });
        setSelectedDispatchId(validId);
        if (validEntryId !== undefined) {
          setSelectedObjectEntryId(validEntryId);
        } else if (validId !== selectedDispatchId) {
          setSelectedObjectEntryId(undefined);
        }
        setRoute('DriverGpsTracking');
        console.log('[AppNavigator] Immediately after goToDriverGpsTracking navigation decision:', {
          newRoute: 'DriverGpsTracking',
          selectedDispatchId: validId,
          selectedObjectEntryId: validEntryId,
        });
      },
      [route, selectedDispatchId]
    );

  const handleDriverBackToDashboard =

    useCallback(

      () => setRoute('DriverDashboard'),

      []

    );



  const goToDriverMyTrip =

    useCallback(

      (dispatchId?: string) => {

        setSelectedDispatchId(

          typeof dispatchId === 'string'

            ? dispatchId

            : undefined

        );

        setRoute('DriverMyTrip');

      },

      []

    );



  const goToDriverTripHistory =

    useCallback(

      () => {

        setRoute('DriverTripHistory');

      },

      []

    );



  const handleDriverArrivedProceedToPod =
    useCallback(
      (dispatchId?: string, entryId?: number | string) => {
        const targetDispatchId = typeof dispatchId === 'string' && dispatchId ? dispatchId : selectedDispatchId;
        const targetEntryId =
          entryId !== undefined && (typeof entryId === 'number' || typeof entryId === 'string')
            ? entryId
            : selectedObjectEntryId;
        console.log('[AppNavigator] Immediately before POD navigation decision: handleDriverArrivedProceedToPod', {
          selectedDispatchId: targetDispatchId,
          objectEntryId: targetEntryId,
          currentRoute: route,
          navigationDecision: 'Proceeding to DriverPod screen with verified identifiers',
        });
        if (typeof dispatchId === 'string' && dispatchId) {
          setSelectedDispatchId(dispatchId);
        }
        if (entryId !== undefined && (typeof entryId === 'number' || typeof entryId === 'string')) {
          setSelectedObjectEntryId(entryId);
        }
        setRoute('DriverPod');
        console.log('[AppNavigator] Immediately after POD navigation decision:', {
          newRoute: 'DriverPod',
          selectedDispatchId: targetDispatchId,
          selectedObjectEntryId: targetEntryId,
        });
      },
      [route, selectedDispatchId, selectedObjectEntryId]
    );



  const handleDriverTakePhoto =

    useCallback(

      () => setRoute('DriverCamera'),

      []

    );



  const handleDriverPhotoCaptured =
    useCallback(
      (photo: CapturedPhoto) => {
        // Requirement B.5: On every new capture or retake, replace previous image and metadata
        setDriverCapturedPhotos([photo]);
        setRoute('DriverPod');
      },
      []
    );

  const handleDriverDeletePhoto =
    useCallback(
      (id: string) => {
        setDriverCapturedPhotos(
          (prev) =>
            prev.filter(
              (p) => p.id !== id
            )
        );
      },
      []
    );

  const handleDriverPodSubmit =
    useCallback(
      async (screenTripSummary?: PodTripSummary | null) => {
        let summary = screenTripSummary ?? driverPodTripSummary;

        const summaryHasDispatchCode =
          summary?.objectEntryId !== undefined &&
          (String(summary.objectEntryId).toUpperCase().startsWith('DSP-') ||
           String(summary.objectEntryId) === String(summary.tripId) ||
           String(summary.objectEntryId) === '746588' ||
           !/^\d+$/.test(String(summary.objectEntryId)));

        const validSelectedEntryId =
          selectedObjectEntryId !== undefined &&
          !String(selectedObjectEntryId).toUpperCase().startsWith('DSP-') &&
          /^\d+$/.test(String(selectedObjectEntryId))
            ? String(selectedObjectEntryId)
            : undefined;

        if (!summary || !summary.objectEntryId || summaryHasDispatchCode) {
          summary = await driverPodService.getPodTripSummary({
            userId: currentUser?.id,
            dispatchId: selectedDispatchId,
            objectEntryId: validSelectedEntryId,
            accessToken: accessToken ?? undefined,
          });
        }

        const realObjectEntryId =
          validSelectedEntryId ??
          (summary?.objectEntryId &&
           !String(summary.objectEntryId).toUpperCase().startsWith('DSP-') &&
           /^\d+$/.test(String(summary.objectEntryId))
            ? String(summary.objectEntryId)
            : undefined);

        if (driverCapturedPhotos.length === 0) {
          throw new Error('At least one photo must be captured before submitting POD.');
        }

        console.log('[AppNavigator] Submitting POD with authoritative objectEntryId:', {
          realObjectEntryId,
          selectedObjectEntryId,
          summaryObjectEntryId: summary?.objectEntryId,
          selectedDispatchId,
          tripId: summary?.tripId,
        });

        const targetEntryId = realObjectEntryId || summary?.objectEntryId || selectedObjectEntryId || selectedDispatchId || '';
        const targetTripId = summary?.tripId || selectedDispatchId;

        // Check if already submitted on backend or locally
        const existingStatus = await driverPodService.checkPodSubmissionStatus(
          { objectEntryId: targetEntryId, dispatchId: targetTripId },
          accessToken ?? undefined
        );
        if (existingStatus.isSubmitted) {
          Alert.alert(
            'Already Submitted',
            `Proof of Delivery has already been submitted for dispatch ${targetTripId || targetEntryId}.`
          );
          if (summary) {
            setDriverPodTripSummary(summary);
          }
          setRoute('DriverPodSuccess');
          return;
        }

        const submission = await driverPodService.submitPod({
          objectEntryId: targetEntryId,
          photos: driverCapturedPhotos,
          accessToken: accessToken ?? undefined,
          tripId: targetTripId,
          vehicleNumber: summary?.vehicleNumber,
          driverName: summary?.driverName,
          siteCode: summary?.siteCode,
          siteName: summary?.siteName,
          receiverName: summary?.receiver?.name,
        });

        setDriverPodSubmission(submission);
        if (summary) {
          setDriverPodTripSummary(summary);
        }
        setRoute('DriverPodSuccess');
      },
      [
        accessToken,
        currentUser?.id,
        driverCapturedPhotos,
        driverPodTripSummary,
        selectedDispatchId,
        selectedObjectEntryId,
      ]
    );



  const handleDriverPodSuccessBackToDashboard =

    useCallback(

      () => {



        setDriverCapturedPhotos([]);

        setDriverPodSubmission(null);



        setRoute(

          'DriverDashboard'

        );

      },

      []

    );



  const handleDriverViewTripHistory =

    useCallback(

      () => {

        goToDriverTripHistory();

      },

      [goToDriverTripHistory]

    );







  if (isRestoringSession) {

    return null;

  }

  // ============================================================

  // ROUTING

  // ============================================================



  const renderRoute = (): React.ReactElement => {

    switch (route) {



      // ==========================================================

      // SPLASH

      // ==========================================================



      case 'Splash':

        return (

          <SplashScreen

            onFinish={

              goToLogin

            }

          />

        );





      // ==========================================================

      // LOGIN

      // ==========================================================



      case 'Login':

        return (
          <LoginScreen
            role={selectedRole ?? undefined}
            onBack={
              handleLoginBack
            }
            onSendOtp={
              handleSendOtp
            }
          />
        );


      // ==========================================================
      // OTP VERIFICATION
      // ==========================================================

      case 'Otp':
        return (
          <OtpScreen
            key={otpVerificationToken || otpPhoneNumber || 'otp-screen'}
            phoneNumber={otpPhoneNumber}
            verificationToken={otpVerificationToken}
            onChangePhone={handleChangePhone}
            onVerifyOtp={handleVerifyOtp}
            onResendOtp={handleResendOtp}
          />
        );


      // ==========================================================

      // ENGINEER DASHBOARD

      // ==========================================================



      case 'Dashboard':



        if (currentUser) {

          return (

            <DashboardScreen

              user={currentUser}

              onLogout={

                handleLogout

              }

              onNavigateToActivity={

                goToActivity

              }

              onNavigateToProfile={

                goToEngineerProfile

              }

              onNavigateToProductSelection={

                goToProductSelection

              }

              onBottomTabPress={

                handleBottomTab

              }

            />

          );

        }



        return (

          <SplashScreen

            onFinish={

              goToLogin

            }

          />

        );





      // ==========================================================

      // DRIVER DASHBOARD

      // ==========================================================



      case 'DriverDashboard':



        if (currentUser) {

          return (

            <DriverDashboardScreen

              user={currentUser}



              accessToken={

                accessToken ??

                undefined

              }



              onLogout={

                handleLogout

              }



              onNavigateToProfile={

                goToDriverProfile

              }



              onNavigateToNotifications={

                goToDriverNotifications

              }



              notificationCount={

                notificationCount

              }



              onNavigateToLiveGps={

                goToDriverGpsTracking

              }



              onNavigateToPod={

                handleDriverArrivedProceedToPod

              }



              onNavigateToMyTrip={

                goToDriverMyTrip

              }



              onNavigateToTripHistory={

                goToDriverTripHistory

              }

            />

          );

        }



        return (

          <SplashScreen

            onFinish={

              goToLogin

            }

          />

        );





      // ==========================================================

      // DRIVER NOTIFICATIONS

      // ==========================================================



      case 'DriverNotifications':



        return (

          <NotificationsScreen

            accessToken={

              accessToken ?? ''

            }

            refreshToken={

              refreshToken ?? ''

            }

            onTokenRefresh={

              handleTokenRefresh

            }

            onBack={

              goToDashboard

            }

            onUnreadCountChange={

              setNotificationCount

            }

          />

        );





      // ==========================================================

      // DRIVER GPS

      // ==========================================================



      case 'DriverGpsTracking':



        return (

          <DriverGpsTrackingScreen

            user={

              currentUser ?? undefined

            }

            accessToken={

              accessToken ?? undefined

            }

            dispatchId={

              selectedDispatchId

            }

            initialObjectEntryId={

              selectedObjectEntryId

            }

            isInitiallyArrived={

              Boolean(selectedDispatchId && recentlyArrivedDispatchId === selectedDispatchId)

            }

            onBack={

              handleDriverBackToDashboard

            }

            onArrivedProceedToPod={

              handleDriverArrivedProceedToPod

            }

            onNavigateToProfile={

              goToDriverProfile

            }

            onNavigateToNotifications={

              goToDriverNotifications

            }

            onNavigateToMyTrip={

              goToDriverMyTrip

            }

            onNavigateToTripHistory={

              goToDriverTripHistory

            }

            notificationCount={

              notificationCount

            }

          />

        );





      // ==========================================================

      // DRIVER MY TRIP (TRIP DETAILS & MANIFEST)

      // ==========================================================



      case 'DriverMyTrip':



        return (

          <MyTripScreen

            user={currentUser ?? undefined}

            userId={currentUser?.id}

            accessToken={accessToken ?? undefined}

            selectedDispatchId={selectedDispatchId}

            notificationCount={

              notificationCount

            }

            onBack={

              handleDriverBackToDashboard

            }

            onNavigateToDashboard={handleDriverBackToDashboard

            }

            onNavigateToLiveGps={

              goToDriverGpsTracking

            }

            onNavigateToPod={

              handleDriverArrivedProceedToPod

            }

            onNavigateToProfile={

              goToDriverProfile

            }

            onNavigateToNotifications={

              goToDriverNotifications

            }

            onNavigateToHistory={

              goToDriverTripHistory

            }

          />

        );





      // ==========================================================

      // DRIVER TRIP HISTORY & LOGS

      // ==========================================================



      case 'DriverTripHistory':



        return (

          <DriverTripHistoryScreen

            user={currentUser ?? undefined}

            userId={currentUser?.id}

            accessToken={accessToken ?? undefined}

            notificationCount={notificationCount}

            onBack={handleDriverBackToDashboard}

            onNavigateToDashboard={handleDriverBackToDashboard}

            onNavigateToMyTrip={goToDriverMyTrip}

            onNavigateToLiveGps={goToDriverGpsTracking}

            onNavigateToProfile={goToDriverProfile}

            onNavigateToNotifications={goToDriverNotifications}

            onNavigateToTripDetails={(tripId) => {

              goToDriverMyTrip(tripId);

            }}

          />

        );





      // ==========================================================

      // DRIVER POD

      // ==========================================================



      case 'DriverPod':
        return (
          <DriverPodScreen
            capturedPhotos={driverCapturedPhotos}
            onTakePhoto={handleDriverTakePhoto}
            onDeletePhoto={handleDriverDeletePhoto}
            onBack={handleDriverBackToDashboard}
            onSubmit={handleDriverPodSubmit}
            onNavigateToProfile={goToDriverProfile}
            onNavigateToNotifications={goToDriverNotifications}
            onNavigateToMyTrip={goToDriverMyTrip}
            onNavigateToTripHistory={goToDriverTripHistory}
            onNavigateToLiveGps={goToDriverGpsTracking}
            notificationCount={notificationCount}
            userId={currentUser?.id}
            accessToken={accessToken ?? undefined}
            selectedDispatchId={selectedDispatchId}
            objectEntryId={selectedObjectEntryId ?? driverPodTripSummary?.objectEntryId}
            initialTripSummary={driverPodTripSummary}
          />
        );

      // ==========================================================
      // DRIVER CAMERA
      // ==========================================================

      case 'DriverCamera':
        return (
          <CameraCaptureScreen
            siteCode={driverPodTripSummary?.siteCode || 'AW-NGP-014'}
            siteName={driverPodTripSummary?.siteName || 'Digdoh Anganwadi'}
            activityLabel="Proof of Delivery • Cargo Evidence"
            onCancel={() => setRoute('DriverPod')}
            onPhotoCaptured={handleDriverPhotoCaptured}
          />
        );





      // ==========================================================

      // DRIVER POD SUCCESS

      // ==========================================================



      case 'DriverPodSuccess':



        return (

          <DriverPodSuccessScreen

            tripSummary={

              driverPodTripSummary

            }

            submissionResult={

              driverPodSubmission

            }

            onViewTripHistory={

              handleDriverViewTripHistory

            }

            onBackToDashboard={

              handleDriverPodSuccessBackToDashboard

            }

            onNavigateToProfile={

              goToDriverProfile

            }

            onNavigateToNotifications={

              goToDriverNotifications

            }

            onNavigateToMyTrip={

              goToDriverMyTrip

            }

            onNavigateToLiveGps={

              goToDriverGpsTracking

            }

            notificationCount={

              notificationCount

            }

          />

        );





      // ==========================================================

      // ENGINEER PROFILE

      // ==========================================================



      case 'EngineerProfile':



        if (currentUser) {

          return (

            <EngineerProfileScreen

              user={currentUser}

              onBack={

                handleBackToDashboardFromProfile

              }

              onLogout={

                handleLogout

              }

              onBottomTabPress={

                handleBottomTab

              }

            />

          );

        }



        return (

          <SplashScreen

            onFinish={

              goToLogin

            }

          />

        );





      // ==========================================================

      // DRIVER PROFILE

      // ==========================================================



      case 'DriverProfile':



        if (currentUser) {

          return (

            <DriverProfileScreen

              user={currentUser}

              accessToken={

                accessToken ?? undefined

              }

              refreshToken={

                refreshToken ?? undefined

              }

              onTokenRefresh={

                handleTokenRefresh

              }

              onBack={

                handleBackToDashboardFromProfile

              }

              onLogout={

                handleLogout

              }

              onNavigateToNotifications={

                goToDriverNotifications

              }

              onNavigateToLiveGps={

                goToDriverGpsTracking

              }

              onNavigateToMyTrip={

                goToDriverMyTrip

              }

              onNavigateToTripHistory={

                goToDriverTripHistory

              }

              notificationCount={

                notificationCount

              }

            />

          );

        }



        return (

          <SplashScreen

            onFinish={

              goToLogin

            }

          />

        );





      // ==========================================================

      // PRODUCT SELECTION

      // ==========================================================



      case 'ProductSelection':



        return (

          <ProductSelectionScreen

            onBack={

              handleBackFromProductSelection

            }

            onProductSelect={

              handleProductSelect

            }

            notificationCount={3}

            onLogout={

              handleLogout

            }

            onBottomTabPress={

              handleBottomTab

            }

            onNavigateToProfile={

              currentUser?.role ===

                'TRUCK_DRIVER'

                ? goToDriverProfile

                : goToEngineerProfile

            }

          />

        );





      // ==========================================================

      // SITE SELECTION

      // ==========================================================



      case 'SiteSelection':



        if (selectedProduct) {

          return (

            <SiteScreen

              project={

                selectedProduct

              }

              onBack={

                handleBackFromSiteSelection

              }

              notificationCount={3}

              onLogout={

                handleLogout

              }

              onSiteSelect={

                handleSiteSelect

              }

              onBottomTabPress={

                handleBottomTab

              }

              onNavigateToProfile={

                currentUser?.role ===

                  'TRUCK_DRIVER'

                  ? goToDriverProfile

                  : goToEngineerProfile

              }

            />

          );

        }



        return (

          <ProductSelectionScreen

            onBack={

              handleBackFromProductSelection

            }

            onProductSelect={

              handleProductSelect

            }

            notificationCount={3}

            onLogout={

              handleLogout

            }

            onBottomTabPress={

              handleBottomTab

            }

            onNavigateToProfile={

              currentUser?.role ===

                'TRUCK_DRIVER'

                ? goToDriverProfile

                : goToEngineerProfile

            }

          />

        );





      // ==========================================================

      // ACTIVITY

      // ==========================================================



      case 'Activity':



        return (

          <ActivityScreen

            userId={

              currentUser?.id ?? ''

            }



            accessToken={

              accessToken ??

              undefined

            }



            // AUTH UPDATE:

            refreshToken={

              refreshToken ??

              undefined

            }



            // AUTH UPDATE:

            onTokenRefresh={

              handleTokenRefresh

            }



            onBack={

              goToDashboard

            }



            onSelectActivity={

              handleSelectActivityOnly

            }



            onLogDailyProgress={

              handleLogDailyProgress

            }



            onNavigateToProfile={

              currentUser?.role ===

                'TRUCK_DRIVER'

                ? goToDriverProfile

                : goToEngineerProfile

            }



            onBottomTabPress={

              handleBottomTab

            }

          />

        );





      // ==========================================================

      // DAILY PROGRESS

      // ==========================================================



      case 'DailyProgress':



        if (selectedActivity) {

          return (

            <DailyProgressScreen

              activityCode={

                selectedActivity.code

              }

              activityName={

                selectedActivity.name

              }

              activityStatus={

                selectedActivity.status

              }

              stageLabel={

                selectedActivity.stage

              }

              scheduleLabel="—"

              unitLabel={

                selectedActivity.targetQty

              }

              capturedPhotos={

                capturedPhotos

              }

              onTakePhoto={

                handleTakePhoto

              }

              onDeletePhoto={

                handleDeletePhoto

              }

              progressNotes={

                progressNotes

              }

              onProgressNotesChange={

                setProgressNotes

              }

              onBack={

                handleDailyProgressBack

              }

              onProceed={

                handleDailyProgressProceed

              }

              onNavigateToProfile={

                currentUser?.role ===

                  'TRUCK_DRIVER'

                  ? goToDriverProfile

                  : goToEngineerProfile

              }

              onBottomTabPress={

                handleBottomTab

              }

            />

          );

        }



        return (

          <ActivityScreen

            userId={

              currentUser?.id ?? ''

            }



            accessToken={

              accessToken ??

              undefined

            }



            refreshToken={

              refreshToken ??

              undefined

            }



            onTokenRefresh={

              handleTokenRefresh

            }



            onBack={

              goToDashboard

            }



            onSelectActivity={

              handleSelectActivityOnly

            }



            onLogDailyProgress={

              handleLogDailyProgress

            }



            onNavigateToProfile={

              currentUser?.role ===

                'TRUCK_DRIVER'

                ? goToDriverProfile

                : goToEngineerProfile

            }



            onBottomTabPress={

              handleBottomTab

            }

          />

        );





      // ==========================================================

      // WATERMARK PREVIEW

      // ==========================================================



      case 'WatermarkPreview':



        if (selectedActivity) {

          return (

            <WatermarkPreviewScreen

              activityCode={

                selectedActivity.code

              }

              activityName={

                selectedActivity.name

              }

              siteCode="AW-NGP-014"

              siteName="Digdoh Model Center"

              capturedPhotos={

                capturedPhotos

              }

              progressNotes={

                progressNotes

              } onBack={

                handleWatermarkBack

              }

              onSubmit={

                handleWatermarkSubmit

              }

              onNavigateToProfile={

                currentUser?.role ===

                  'TRUCK_DRIVER'

                  ? goToDriverProfile

                  : goToEngineerProfile

              }

            />

          );

        }



        return (

          <ActivityScreen

            userId={

              currentUser?.id ?? ''

            }



            accessToken={

              accessToken ??

              undefined

            }



            refreshToken={

              refreshToken ??

              undefined

            }



            onTokenRefresh={

              handleTokenRefresh

            }



            onBack={

              goToDashboard

            }



            onSelectActivity={

              handleSelectActivityOnly

            }



            onLogDailyProgress={

              handleLogDailyProgress

            }



            onNavigateToProfile={

              currentUser?.role ===

                'TRUCK_DRIVER'

                ? goToDriverProfile

                : goToEngineerProfile

            }



            onBottomTabPress={

              handleBottomTab

            }

          />

        );





      // ==========================================================

      // SUBMISSION SUCCESS

      // ==========================================================



      case 'SubmissionSuccess':



        if (selectedActivity) {

          return (

            <SubmissionSuccessScreen

              activityCode={

                selectedActivity.code

              }

              activityName={

                selectedActivity.name

              }

              siteCode="AW-NGP-014"

              siteName="Digdoh Anganwadi"

              capturedPhotos={

                capturedPhotos

              }

              progressNotes={

                progressNotes

              }

              onLogAnother={

                handleSubmissionLogAnother

              }

              onBackToDashboard={

                handleSubmissionBackToDashboard

              }

              onNavigateToProfile={

                currentUser?.role ===

                  'TRUCK_DRIVER'

                  ? goToDriverProfile

                  : goToEngineerProfile

              }

            />

          );

        }



        return (

          <ActivityScreen

            userId={

              currentUser?.id ?? ''

            }



            accessToken={

              accessToken ??

              undefined

            }



            refreshToken={

              refreshToken ??

              undefined

            }



            onTokenRefresh={

              handleTokenRefresh

            }



            onBack={

              goToDashboard

            }



            onSelectActivity={

              handleSelectActivityOnly

            }



            onLogDailyProgress={

              handleLogDailyProgress

            }



            onNavigateToProfile={

              currentUser?.role ===

                'TRUCK_DRIVER'

                ? goToDriverProfile

                : goToEngineerProfile

            }



            onBottomTabPress={

              handleBottomTab

            }

          />

        );





      // ==========================================================

      // CAMERA

      // ==========================================================



      case 'Camera':



        if (selectedActivity) {

          return (

            <CameraCaptureScreen

              siteCode="AW-NGP-014"

              siteName="Digdoh Model Center"

              activityLabel={`${selectedActivity.code} ${selectedActivity.name}`}

              onCancel={() =>

                setRoute('DailyProgress')

              }

              onPhotoCaptured={

                handlePhotoCaptured

              }

            />

          );

        }



        return (

          <ActivityScreen

            userId={

              currentUser?.id ?? ''

            }



            accessToken={

              accessToken ??

              undefined

            }



            refreshToken={

              refreshToken ??

              undefined

            }



            onTokenRefresh={

              handleTokenRefresh

            }



            onBack={

              goToDashboard

            }



            onSelectActivity={

              handleSelectActivityOnly

            }



            onLogDailyProgress={

              handleLogDailyProgress

            }



            onNavigateToProfile={

              currentUser?.role ===

                'TRUCK_DRIVER'

                ? goToDriverProfile

                : goToEngineerProfile

            }



            onBottomTabPress={

              handleBottomTab

            }

          />

        );





      // ==========================================================

      // DEFAULT

      // ==========================================================



      default:

        return (

          <SplashScreen

            onFinish={

              goToLogin

            }

          />

        );

    }

  };



  return (

    <View style={{ flex: 1 }}>

      {renderRoute()}



      {/* Keeps GPS pings going in the background (app minimised / closed) while a journey is In Transit */}
      <BackgroundGpsController
        enabled={isSignedIn && currentUser?.role === 'TRUCK_DRIVER'}
        userId={currentUser?.id ?? null}
        accessToken={accessToken}
      />

      {/* "Destination arrived?" popup — works on every driver screen except GPS tracking and History */}

      <GlobalArrivalPrompt

        enabled={

          isSignedIn &&

          currentUser?.role === 'TRUCK_DRIVER' &&

          route !== 'DriverGpsTracking' &&

          route !== 'DriverTripHistory'

        }

        userId={currentUser?.id ?? null}

        accessToken={accessToken}

        onJourneyCompleted={(dispatchId, entryId) => {
          console.log('[AppNavigator] Immediately before handling arrival confirmation callback:', {
            selectedDispatchId: dispatchId,
            objectEntryId: entryId,
            currentRoute: route,
            navigationDecision: 'Received arrival confirmation from GlobalArrivalPrompt; updating selected dispatch and navigating to DriverGpsTracking with arrived state',
          });
          setSelectedDispatchId(dispatchId);
          if (entryId !== undefined) {
            setSelectedObjectEntryId(entryId);
          }
          arrivalConfirmationService.confirmArrival(dispatchId);
          if (entryId !== undefined) {
            arrivalConfirmationService.confirmArrival(entryId);
          }
          setRecentlyArrivedDispatchId(dispatchId);
          setRoute('DriverGpsTracking');
          console.log('[AppNavigator] Immediately after handling arrival confirmation callback:', {
            newRoute: 'DriverGpsTracking',
            selectedDispatchId: dispatchId,
            selectedObjectEntryId: entryId ?? selectedObjectEntryId,
            recentlyArrivedDispatchId: dispatchId,
            isInitiallyArrived: true,
          });
        }}

      />



      <NotificationToast

        toast={notificationToast}

        onPress={openNotificationsScreen}

        onDismiss={dismissNotificationToast}

      />

    </View>

  );

};
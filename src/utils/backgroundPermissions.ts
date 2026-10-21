/**
 * Permission helpers that keep dispatch alerts and background GPS working on real phones.
 *   1. "Allow all the time" location  -> Android lets the tracking service keep (and re-)start in the background.
 *   2. Battery optimisation exemption -> Xiaomi / Oppo / Vivo / Samsung otherwise delay or kill pushes and the
 *      tracking service when the app is closed.
 *   3. Notifications blocked          -> explain how to switch them back on (the system dialog can be refused for good).
 * The system dialogs are shown by Android; the explanations below are shown by the app. Every function is
 * best-effort and never throws, and none of them blocks tracking.
 */
import { Alert, Linking, Platform } from 'react-native';
import * as Location from 'expo-location';
import { appStorage } from '../services/sessionStorage';
import { loadNotificationsModule } from './optionalNativeModules';

const ASKED_BG_KEY = 'fuji_asked_bg_location';
const ASKED_BATTERY_KEY = 'fuji_asked_battery_opt';

// Explanations shown at most once per app launch.
let notificationHelpShown = false;
let locationHelpShown = false;

/** Shows an explanation with "Later" / "<open>" buttons. Resolves when the dialog is closed. */
function confirmOpen(title: string, message: string, openLabel: string, open: () => Promise<unknown> | void): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      Alert.alert(
        title,
        message,
        [
          { text: 'Later', style: 'cancel', onPress: () => resolve() },
          {
            text: openLabel,
            onPress: () => {
              Promise.resolve()
                .then(open)
                .catch(() => { })
                .then(() => resolve());
            },
          },
        ],
        { cancelable: true, onDismiss: () => resolve() }
      );
    } catch {
      resolve();
    }
  });
}

export async function ensureBackgroundLocationPermission(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const current = await Location.getBackgroundPermissionsAsync();
    if (current.status === 'granted') return true;
    const alreadyAsked = await appStorage.getItem(ASKED_BG_KEY);
    if (!alreadyAsked && current.canAskAgain !== false) {
      await appStorage.setItem(ASKED_BG_KEY, '1');
      const next = await Location.requestBackgroundPermissionsAsync();
      if (next.status === 'granted') return true;
    }
    // Refused (or Android will not show the dialog again): explain once per launch, without blocking tracking.
    if (!locationHelpShown) {
      locationHelpShown = true;
      void confirmOpen(
        'Allow location "all the time"',
        'Without it your trip stops being tracked when the app is closed or the screen is off.\n\nOpen Settings > Permissions > Location and choose "Allow all the time".',
        'Open Settings',
        () => Linking.openSettings()
      );
    }
    return false;
  } catch (err) {
    console.warn('[bg-permissions] background location request failed:', err);
    return false;
  }
}

/**
 * Explains, once per install, how to exempt the app from battery optimisation and opens Android's battery list.
 * `wait: true` resolves only after the driver closed the explanation (use it to show dialogs one after another).
 */
export async function promptBatteryOptimizationOnce(opts?: { wait?: boolean }): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    if (await appStorage.getItem(ASKED_BATTERY_KEY)) return;
    await appStorage.setItem(ASKED_BATTERY_KEY, '1');
    const shown = confirmOpen(
      'Keep dispatch alerts working',
      'To get new-dispatch alerts and live tracking while the app is closed, set "Fuji Silvertech" to "Unrestricted" / "Don\'t optimise" in the battery list that opens next.\n\nOn Xiaomi, Oppo, Vivo and Realme phones also turn on "Autostart" for this app.',
      'Open battery settings',
      () => Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS')
    );
    if (opts?.wait) await shown;
  } catch (err) {
    console.warn('[bg-permissions] battery settings could not be opened:', err);
  }
}

/**
 * Call when the notification permission was refused. Android only shows its dialog a couple of times, after that
 * the only way back is the app's settings page, so explain it once per launch. Does nothing where notifications
 * are not supported at all (Expo Go, web).
 */
export async function promptNotificationSettingsOnce(): Promise<void> {
  if (Platform.OS === 'web' || notificationHelpShown) return;
  if (!loadNotificationsModule()) return;
  notificationHelpShown = true;
  await confirmOpen(
    'Notifications are turned off',
    'You will not get new-dispatch alerts at the top of the screen.\n\nOpen Settings > Notifications and turn them on for Fuji Silvertech.',
    'Open Settings',
    () => Linking.openSettings()
  );
}

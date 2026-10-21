/**
 * Persistent per-install device identifier, sent as `deviceId` on every
 * mobile-gps-ping request so the backend/Redis knows which physical device
 * a ping came from.
 *
 * Uses the id the OS already exposes for this app install — no extra
 * permission prompt needed:
 *   - Android: ANDROID_ID — stable per device + app signing key, changes
 *     only on factory reset.
 *   - iOS:     identifierForVendor — stable per device + developer account,
 *     changes only if the app (and all apps from the same vendor) is
 *     uninstalled.
 *
 * Requires the `expo-application` package:
 *   npx expo install expo-application
 */
import * as Application from 'expo-application';
import { Platform } from 'react-native';

let cachedDeviceId: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cachedDeviceId) return cachedDeviceId;

  try {
    if (Platform.OS === 'android') {
      cachedDeviceId = Application.getAndroidId() ?? `android-unknown-${Date.now()}`;
    } else if (Platform.OS === 'ios') {
      cachedDeviceId = (await Application.getIosIdForVendorAsync()) ?? `ios-unknown-${Date.now()}`;
    } else {
      // Web / other — no stable OS-level id available.
      cachedDeviceId = `web-unknown-${Date.now()}`;
    }
  } catch (err) {
    console.warn('[deviceId] failed to read native device id, using fallback:', err);
    cachedDeviceId = `fallback-${Platform.OS}-${Date.now()}`;
  }

  return cachedDeviceId;
}

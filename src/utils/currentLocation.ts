/**
 * One-shot "where is the phone right now" helper, used for the `liveGPS`
 * param of start-journey / complete-journey.
 *
 * Tries a fresh high-accuracy fix first; if that times out, falls back to the
 * OS's last known position (only if it is recent enough).
 */
import * as Location from 'expo-location';

const FRESH_FIX_TIMEOUT_MS = 12_000;
const MAX_LAST_KNOWN_AGE_MS = 2 * 60 * 1000;

export class LocationUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationUnavailableError';
  }
}

export async function ensureForegroundLocationPermission(): Promise<boolean> {
  const { status: existing } = await Location.getForegroundPermissionsAsync();
  if (existing === 'granted') return true;
  const { status } = await Location.requestForegroundPermissionsAsync();
  return status === 'granted';
}

function timeout<T>(ms: number): Promise<T> {
  return new Promise<T>((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), ms));
}

/** Returns the current position. Throws LocationUnavailableError with a driver-friendly message. */
export async function getCurrentCoords(): Promise<{ latitude: number; longitude: number }> {
  const granted = await ensureForegroundLocationPermission();
  if (!granted) {
    throw new LocationUnavailableError('Location permission is required. Please allow location access in Settings.');
  }

  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      timeout<Location.LocationObject>(FRESH_FIX_TIMEOUT_MS),
    ]);
    return { latitude: fresh.coords.latitude, longitude: fresh.coords.longitude };
  } catch (err) {
    console.warn('[currentLocation] fresh fix failed, trying last known:', err);
  }

  const last = await Location.getLastKnownPositionAsync({ maxAge: MAX_LAST_KNOWN_AGE_MS }).catch(() => null);
  if (last) {
    return { latitude: last.coords.latitude, longitude: last.coords.longitude };
  }

  throw new LocationUnavailableError('Unable to get your current location. Please turn on GPS and try again.');
}

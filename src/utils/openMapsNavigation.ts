import { Alert, Linking, Platform } from 'react-native';

/**
 * Opens the phone's Maps app with turn-by-turn navigation to the destination.
 *
 * COST: none. This only hands the destination to the Google Maps app that is
 * installed on the phone; it makes NO Google Maps Platform API call from this
 * app, so it is never billed to your Google Cloud project.
 *
 * Order tried:
 *   Android  1) google.navigation:q=lat,lng&mode=d   -> Google Maps, navigation starts
 *            2) geo:0,0?q=lat,lng(label)             -> any maps app
 *            3) https://www.google.com/maps/dir/...  -> browser
 *   iOS      1) comgooglemaps://  (if Google Maps is installed)
 *            2) https://maps.apple.com/?daddr=...    -> Apple Maps
 *
 * The origin is left out on purpose: Maps then uses the driver's current
 * location, which is always newer than anything this app could pass.
 */
export async function openMapsNavigation(lat: number, lng: number, label?: string): Promise<boolean> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
    Alert.alert('Destination missing', 'This dispatch has no site location, so navigation cannot be opened.');
    return false;
  }

  const dest = `${lat},${lng}`;
  const encodedLabel = encodeURIComponent(label || 'Destination');
  const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;

  const candidates: string[] =
    Platform.OS === 'android'
      ? [`google.navigation:q=${dest}&mode=d`, `geo:0,0?q=${dest}(${encodedLabel})`, webUrl]
      : Platform.OS === 'ios'
        ? [`comgooglemaps://?daddr=${dest}&directionsmode=driving`, `https://maps.apple.com/?daddr=${dest}&dirflg=d`, webUrl]
        : [webUrl];

  // Try each one directly: canOpenURL needs extra manifest entries on Android 11+
  // and can report false for apps that do open, so openURL + catch is more reliable.
  for (const url of candidates) {
    try {
      await Linking.openURL(url);
      console.log('[openMapsNavigation] opened', url);
      return true;
    } catch (err) {
      console.log('[openMapsNavigation] could not open', url, String(err));
    }
  }

  Alert.alert('Maps not available', 'Could not open a maps app on this phone.');
  return false;
}

/**
 * Lottie player for Android / iOS (lottie-react-native, native module).
 * Web uses LottieView.ts instead: lottie-react-native's web build needs
 * @lottiefiles/dotlottie-react, which this app does not ship.
 * null when the native module is not in this build (old dev client) -> callers show a fallback.
 */
let LottieView: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const lottie = require('lottie-react-native');
  LottieView = lottie?.default ?? lottie;
} catch {
  LottieView = null;
}

export default LottieView;

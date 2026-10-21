# Fuji Silvertech Mobile — Phase 1 (Splash + Login)

Expo + React Native + TypeScript implementation of the Splash Screen and
Login Screen, built to match the supplied reference design as closely as
possible using the supplied brand assets.

## Scope of this build

Only the following are implemented, per current requirements:

- Splash Screen
- Login Screen
- Splash → Login navigation
- Login form state, validation, and error states
- Authentication service architecture, ready for Liferay Headless API
  integration once endpoint details are provided

No dashboard, site selection, photo capture, GPS, offline sync, or
notification screens are included — those are out of scope for this phase.

## Getting started

Built and pinned against **Expo SDK 54** (React Native 0.81.5, React 19.1.0) to match Expo Go SDK 54.

```bash
npm install
npm start
```

Then press `a` for Android (or scan the QR code with Expo Go).

### Note on Android edge-to-edge (SDK 54)

Starting with SDK 54, Android edge-to-edge display is mandatory and cannot be
disabled — content can render behind the status/navigation bars. Both
`SplashScreen.tsx` and `LoginScreen.tsx` already wrap their content in
`SafeAreaView` from `react-native-safe-area-context`, so this shouldn't
require any changes, but keep it in mind if you add new full-screen views.

## Project structure

```
src/
├── components/     Reusable UI: AppLogo, AppTextInput, PasswordInput,
│                   PrimaryButton, SecondaryButton, Divider, LoadingIndicator
├── screens/        SplashScreen.tsx, LoginScreen.tsx
├── navigation/      AppNavigator.tsx (Splash -> Login only, for now)
├── services/       authService.ts — the only place that knows how login works
├── api/            client.ts — generic Liferay API client (base URL unset)
├── theme/          colors.ts, spacing.ts, typography.ts
├── types/          auth.ts
└── assets/images/  supplied brand assets, used as-is
```

## Where each supplied asset is used

| Asset | Used in | Purpose |
|---|---|---|
| `fujisilvertlogo.png` | Splash + Login header | Official logo, rendered via `AppLogo`, untouched aspect ratio |
| `concrete-background.png` | Splash screen | Full-screen background |
| `splash-bottom-geometry.png` | Splash screen | Decorative bottom artwork |
| `header-curve-bg.png` | Login screen header | Curved header background behind the logo |
| `footer-strip.png` | Login screen footer | Decorative footer artwork |
| `blue-accent-line.png` | Not directly used yet | The accent lines already baked into `concrete-background.png`, `header-curve-bg.png`, and `splash-bottom-geometry.png` cover the visible accent in the reference. Kept in `assets/images/` for reuse elsewhere (e.g. dividers on future screens). |

## Color system

All brand colors are centralized in `src/theme/colors.ts`. The blue,
charcoal, and gray values were derived visually from the supplied assets
and reference image — replace them there if Fuji Silvertech provides an
official brand color spec.

## Liferay Headless API integration

`src/services/authService.ts` and `src/api/client.ts` are intentionally
built against a **placeholder** endpoint and response shape. No endpoint
path, request payload, or response contract has been assumed as final —
these were structured so the real Liferay Headless authentication details
can be dropped in without needing to touch `LoginScreen.tsx`.

To wire up the real API once details are available:

1. Set `EXPO_PUBLIC_LIFERAY_BASE_URL` (see `.env.example`).
2. Replace the placeholder path and payload in `authService.login()`.
3. Update `LoginResponse` in `src/types/auth.ts` to match the real response.

## Notes on the splash delay

The splash screen currently waits on a temporary fixed delay
(`runStartupInitialization` in `SplashScreen.tsx`) before navigating to
Login. This is clearly isolated so it can be replaced with real startup
logic (session restore, remote config, etc.) later without touching the
visual component.

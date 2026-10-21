/**
 * Central logger for live-GPS debugging.
 *
 * Two greppable tags:
 *   [GPS-FIX]   every location fix the phone's GPS gives us (map movement)
 *   [GPS-PING]  everything about pings: gate decision, socket send/queue,
 *               server ack/error, reconnects, Redis read-back, summary
 *
 * Each line is prefixed with a local HH:MM:SS.mmm time so you can check the
 * real interval between pings (should be ~10 s while moving).
 *
 * HOW TO WATCH THEM (phone connected by USB, USB debugging on):
 *   adb logcat -s ReactNativeJS:V | grep -E "GPS-PING|GPS-FIX"
 *   (Windows PowerShell)
 *   adb logcat -s ReactNativeJS:V | Select-String "GPS-PING|GPS-FIX"
 *
 * Works in release/preview APKs too (console.log goes to logcat).
 * Set GPS_LOGGING_ENABLED = false to silence everything.
 */

export const GPS_LOGGING_ENABLED = true;

/** Log every raw location fix ([GPS-FIX], ~every 2 s). Turn off if too noisy. */
export const GPS_LOG_EVERY_FIX = true;

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function stamp(): string {
  const d = new Date();
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function fmtValue(v: unknown): string {
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(6).replace(/0+$/, '').replace(/\.$/, '');
  if (v === null || v === undefined) return '-';
  if (typeof v === 'string') return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function fmt(event: string, data?: Record<string, unknown>): string {
  const parts = data
    ? Object.entries(data)
        .map(([k, v]) => `${k}=${fmtValue(v)}`)
        .join(' ')
    : '';
  return `${stamp()} ${event}${parts ? ' ' + parts : ''}`;
}

/** [GPS-PING] info line. */
export function gpsLog(event: string, data?: Record<string, unknown>): void {
  if (!GPS_LOGGING_ENABLED) return;
  console.log(`[GPS-PING] ${fmt(event, data)}`);
}

/** [GPS-PING] warning line (shows as W in logcat). */
export function gpsWarn(event: string, data?: Record<string, unknown>): void {
  if (!GPS_LOGGING_ENABLED) return;
  console.warn(`[GPS-PING] ${fmt(event, data)}`);
}

/** [GPS-FIX] raw location fix line. */
export function gpsFixLog(event: string, data?: Record<string, unknown>): void {
  if (!GPS_LOGGING_ENABLED || !GPS_LOG_EVERY_FIX) return;
  console.log(`[GPS-FIX] ${fmt(event, data)}`);
}

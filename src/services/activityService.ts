/**
 * Activity data service.
 *
 * Endpoint:
 * GET {BASE_URL}/o/anganwadi/user-site-details?userId={id}
 */

import {
  fetchWithTimeout,
  getBaseUrl,
  requestWithTokenRefresh,
} from '../api/client';

const DEFAULT_TIMEOUT_MS = 15000;
const LOG_TAG = '[activityService]';

export interface ApiCheckpoint {
  checkpointName: string;
  isSelected: boolean;
  checkpointId: string;
  checkpointStatus: string;
}

export interface ApiActivity {
  activityId: number;
  activityName: string;
  activityStatus: string;
  checkpoints: ApiCheckpoint[];
}

export interface ApiStage {
  stageStatus: string;
  stageName: string;
  activities: ApiActivity[];
  stageId: string;
}

export interface ApiSiteItem {
  stages: ApiStage[];
  plannedWindowStartDate: string;
  plannedWindowEndDate: string;
  siteEngineerId: string;
  [key: string]: unknown;
}

export interface ApiResponse {
  userId: string;
  items: ApiSiteItem[];
  totalSites: number;
}

export interface NormalizedCheckpoint {
  checkpointId: string;
  checkpointName: string;
  isSelected: boolean;
  checkpointStatus: string;
}

export interface NormalizedActivity {
  activityId: number;
  activityName: string;
  activityStatus: string;
  checkpoints: NormalizedCheckpoint[];
}

export interface NormalizedStage {
  stageId: string;
  stageName: string;
  stageStatus: string;
  activities: NormalizedActivity[];
}

export interface ActivityBundle {
  stages: NormalizedStage[];
  plannedWindowStartDate: string;
  plannedWindowEndDate: string;
}

function emptyBundle(): ActivityBundle {
  return {
    stages: [],
    plannedWindowStartDate: '',
    plannedWindowEndDate: '',
  };
}

function sanitizeUserId(userId: string): string {
  return String(userId)
    .trim()
    .replace(/^['"]+|['"]+$/g, '');
}

function earliest(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;

  return new Date(a).getTime() <= new Date(b).getTime()
    ? a
    : b;
}

function latest(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;

  return new Date(a).getTime() >= new Date(b).getTime()
    ? a
    : b;
}

const STATUS_RANK: Record<string, number> = {
  pending: 0,
  scheduled: 0,

  'ready to start': 1,
  ready: 1,

  inprogress: 2,
  'in progress': 2,
  'in-progress': 2,

  completed: 3,
};

function rankOf(status: string): number {
  return (
    STATUS_RANK[
      (status || '').toLowerCase()
    ] ?? 0
  );
}

function mergeStatus(
  a: string,
  b: string,
): string {
  return rankOf(b) > rankOf(a) ? b : a;
}

/**
 * Fetch activities for the logged-in user.
 *
 * Authentication flow:
 *
 * 1. Use the current access token.
 * 2. If accessToken + refreshToken are available,
 *    requestWithTokenRefresh handles 401 responses.
 * 3. If the access token is expired and the API returns 401,
 *    the refresh token is used automatically.
 * 4. If a new token is received,
 *    onTokenRefresh updates the parent session.
 */
export async function fetchActivitiesForUser(
  userId: string,
  accessToken?: string,
  refreshToken?: string,
  onTokenRefresh?: (
    newAccessToken: string,
    newRefreshToken: string,
    newExpiresAt: string,
  ) => void,
): Promise<ActivityBundle> {
  console.log(
    `${LOG_TAG} fetchActivitiesForUser called with userId =`,
    JSON.stringify(userId),
  );

  if (!userId) {
    console.warn(
      `${LOG_TAG} no userId provided — returning empty bundle`,
    );

    return emptyBundle();
  }

  const cleanUserId = sanitizeUserId(userId);

  if (cleanUserId !== String(userId)) {
    console.warn(
      `${LOG_TAG} userId was sanitized:`,
      JSON.stringify(userId),
      '->',
      JSON.stringify(cleanUserId),
    );
  }

  if (!cleanUserId) {
    console.warn(
      `${LOG_TAG} userId empty after sanitizing — returning empty bundle`,
    );

    return emptyBundle();
  }

  const baseUrl = getBaseUrl();

  const url =
    `${baseUrl}/o/anganwadi/user-site-details` +
    `?userId=${encodeURIComponent(cleanUserId)}`;

  console.log(
    `${LOG_TAG} baseUrl =`,
    baseUrl,
  );

  console.log(
    `${LOG_TAG} GET`,
    url,
  );

  /*
   * Never print the complete access token.
   * Only indicate that a token exists.
   */
  console.log(
    `${LOG_TAG} auth header:`,
    accessToken
      ? 'Bearer token present'
      : '(none)',
  );

  let response: Response;

  try {
    /*
     * When both tokens are available, use the
     * automatic 401 -> refresh -> retry flow.
     */
    if (accessToken && refreshToken) {
      const result =
        await requestWithTokenRefresh(
          url,
          accessToken,
          refreshToken,
          {
            method: 'GET',
            headers: {
              Accept: 'application/json',
            },
          },
          onTokenRefresh,
        );

      response = result.response;
    } else {
      /*
       * Fallback for requests where a refresh token
       * is not available.
       */
      response = await fetchWithTimeout(url, {
          method: 'GET',
          headers: {
            Accept: 'application/json',

            ...(accessToken
              ? {
                  Authorization:
                    `Bearer ${accessToken}`,
                }
              : {}),
          },
        }, DEFAULT_TIMEOUT_MS);
    }
  } catch (err) {
    console.error(
      `${LOG_TAG} network/timeout error:`,
      err,
    );

    throw err;
  }

  console.log(
    `${LOG_TAG} response status =`,
    response.status,
    'ok =',
    response.ok,
  );

  if (!response.ok) {
    let body: unknown;

    try {
      body = await response.json();
    } catch {
      // Response was not JSON.
    }

    console.warn(
      `${LOG_TAG} request failed`,
      response.status,
      body,
    );

    const err = new Error(
      `Failed to load activities: HTTP ${response.status}`,
    );

    (err as any).status =
      response.status;

    (err as any).body = body;

    throw err;
  }

  const json: ApiResponse =
    await response.json();

  const items = Array.isArray(json.items)
    ? json.items
    : [];

  console.log(
    `${LOG_TAG} response parsed — totalSites =`,
    json.totalSites,
    ' items.length =',
    items.length,
  );

  if (items.length === 0) {
    console.warn(
      `${LOG_TAG} no items in response — returning empty bundle`,
    );

    return emptyBundle();
  }

  /*
   * Merge stages from all returned sites.
   */
  const stageOrder: string[] = [];

  const stageMap =
    new Map<string, NormalizedStage>();

  let windowStart = '';
  let windowEnd = '';

  for (const item of items) {
    windowStart = earliest(
      windowStart,
      item.plannedWindowStartDate ?? '',
    );

    windowEnd = latest(
      windowEnd,
      item.plannedWindowEndDate ?? '',
    );

    for (const stage of item.stages ?? []) {
      const stageKey =
        stage.stageId || stage.stageName;

      let normalizedStage =
        stageMap.get(stageKey);

      if (!normalizedStage) {
        normalizedStage = {
          stageId: stage.stageId,
          stageName: stage.stageName,
          stageStatus: stage.stageStatus,
          activities: [],
        };

        stageMap.set(
          stageKey,
          normalizedStage,
        );

        stageOrder.push(stageKey);
      } else {
        normalizedStage.stageStatus =
          mergeStatus(
            normalizedStage.stageStatus,
            stage.stageStatus,
          );
      }

      /*
       * Merge activities belonging to the stage.
       */
      for (const act of stage.activities ?? []) {
        let normalizedActivity =
          normalizedStage.activities.find(
            (a) =>
              a.activityId ===
              act.activityId,
          );

        if (!normalizedActivity) {
          normalizedActivity = {
            activityId: act.activityId,
            activityName: act.activityName,
            activityStatus:
              act.activityStatus,
            checkpoints: [],
          };

          normalizedStage.activities.push(
            normalizedActivity,
          );
        } else {
          normalizedActivity.activityStatus =
            mergeStatus(
              normalizedActivity.activityStatus,
              act.activityStatus,
            );
        }

        /*
         * Merge checkpoints belonging to the activity.
         */
        for (const cp of act.checkpoints ?? []) {
          const existingCp =
            normalizedActivity.checkpoints.find(
              (c) =>
                c.checkpointId ===
                cp.checkpointId,
            );

          if (!existingCp) {
            normalizedActivity.checkpoints.push({
              checkpointId:
                cp.checkpointId,

              checkpointName:
                cp.checkpointName,

              isSelected:
                cp.isSelected,

              checkpointStatus:
                cp.checkpointStatus,
            });
          } else {
            existingCp.checkpointStatus =
              mergeStatus(
                existingCp.checkpointStatus,
                cp.checkpointStatus,
              );

            existingCp.isSelected =
              existingCp.isSelected ||
              cp.isSelected;
          }
        }
      }
    }
  }

  const stages: NormalizedStage[] =
    stageOrder.map(
      (key) => stageMap.get(key)!,
    );

  const activityCount =
    stages.reduce(
      (sum, stage) =>
        sum + stage.activities.length,
      0,
    );

  const checkpointCount =
    stages.reduce(
      (sum, stage) =>
        sum +
        stage.activities.reduce(
          (sum2, activity) =>
            sum2 +
            activity.checkpoints.length,
          0,
        ),
      0,
    );

  console.log(
    `${LOG_TAG} merged bundle — stages =`,
    stages.length,
    ' activities =',
    activityCount,
    ' checkpoints =',
    checkpointCount,
    ' window =',
    windowStart,
    '->',
    windowEnd,
  );

  return {
    stages,
    plannedWindowStartDate:
      windowStart,
    plannedWindowEndDate:
      windowEnd,
  };
}

export const formatDateRange = (
  start: string,
  end: string,
): string => {
  const fmt = (iso: string): string => {
    if (!iso) return '—';

    try {
      const d = new Date(iso);

      return d.toLocaleDateString(
        'en-GB',
        {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        },
      );
    } catch {
      return iso;
    }
  };

  if (!start && !end) {
    return '—';
  }

  return `${fmt(start)} – ${fmt(end)}`;
};
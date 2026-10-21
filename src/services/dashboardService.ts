/**
 * Dashboard data service.
 *
 * Same pattern as authService.ts: this is the ONLY place that should know
 * how dashboard data is fetched. DashboardScreen calls
 * `dashboardService.getDashboard()` and never touches fetch/axios directly.
 *
 * The Liferay Headless API is not available yet, so this returns hardcoded
 * mock data (matching the approved dashboard design) after a short
 * simulated delay. Swap the internals here once the real endpoints
 * (site assignment, activity counts, progress/checkpoints, etc.) are
 * specified — DashboardScreen will not need to change.
 */

import type { DashboardData } from '../types/dashboard';

const MOCK_FETCH_DELAY_MS = 400;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MOCK_DASHBOARD_DATA: DashboardData = {
  currentSite: {
    id: 'site-awc01-pb01',
    code: 'AWC-01, PB01',
    name: 'Substructure',
  },
  summary: {
    activitiesPlanned: 12,
    activitiesCompleted: 5,
    activitiesInProgress: 3,
    pendingApprovals: 2,
  },
  quickActions: [
    { key: 'myActivities', label: 'My Activities' },
    { key: 'updateProgress', label: 'Update Progress' },
  ],
  progress: {
    overallProgressPercent: 62,
    completedCheckpoints: 245,
    totalCheckpoints: 396,
    periodLabel: 'This Week',
  },
  notificationCount: 3,
};

export const dashboardService = {
  async getDashboard(): Promise<DashboardData> {
    // PLACEHOLDER: replace with real Liferay Headless API calls
    // (e.g. GET /o/c/siteassignments, /o/c/activities, /o/c/progresscheckpoints)
    // aggregated for the logged-in user once endpoints are provided.
    await delay(MOCK_FETCH_DELAY_MS);
    return MOCK_DASHBOARD_DATA;
  },
};

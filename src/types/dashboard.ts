/**
 * Dashboard-related types.
 *
 * IMPORTANT: These shapes are placeholders backed by mock data
 * (see src/services/dashboardService.ts). Replace the mock service's
 * internals with real Liferay Headless API calls once available — screens
 * only depend on these types, not on how the data was fetched.
 */

export interface CurrentSite {
  id: string;
  code: string;
  name: string;
}

export interface TodaysSummary {
  activitiesPlanned: number;
  activitiesCompleted: number;
  activitiesInProgress: number;
  pendingApprovals: number;
}

export type QuickActionKey =
  | 'myActivities'
  | 'updateProgress'
  | 'materialReceipt'
  | 'dispatchTrip'
  | 'liveTracking'
  | 'scanQrElement';

export interface QuickAction {
  key: QuickActionKey;
  label: string;
}

export interface ProgressSummary {
  overallProgressPercent: number;
  completedCheckpoints: number;
  totalCheckpoints: number;
  periodLabel: string;
}

export interface DashboardData {
  currentSite: CurrentSite;
  summary: TodaysSummary;
  quickActions: QuickAction[];
  progress: ProgressSummary;
  notificationCount: number;
}

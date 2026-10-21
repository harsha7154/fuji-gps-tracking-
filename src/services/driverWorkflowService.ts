/**
 * Truck Driver workflow data service.
 *
 * The ONLY place that should know how driver notifications, live GPS
 * tracking, and Proof of Delivery (POD) data are fetched/submitted.
 * DriverNotificationsScreen, DriverGpsTrackingScreen, DriverPodScreen and
 * AppNavigator call `driverWorkflowService.*` and never touch fetch/axios
 * directly.
 *
 * The real dispatch/e-POD API is not available yet, so this returns
 * hardcoded mock data after a short simulated delay. Swap the internals
 * here once the real endpoints are specified — consumers will not need
 * to change.
 */

import { getBaseUrl } from '../api/client';
import { driverPodService } from './driverPodService';
import type {
  DriverNotification,
  DriverNotificationCategory,
  LiveTripTracking,
  PodSubmissionResult,
  PodTripSummary,
  SubmitProofOfDeliveryParams,
} from '../types/driverWorkflow';

const MOCK_FETCH_DELAY_MS = 300;
const MOCK_SUBMIT_DELAY_MS = 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24 && date.getDate() === now.getDate()) return `${diffHours} hr ago`;
  if (diffDays === 1 || (diffHours < 48 && date.getDate() === new Date(now.getTime() - 86400000).getDate())) return 'Yesterday';
  if (diffDays >= 2 && diffDays <= 6) return `${diffDays} days ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export const driverWorkflowService = {
  async getDriverNotifications(accessToken?: string): Promise<DriverNotification[]> {
    try {
      const baseUrl = getBaseUrl();
      const url = `${baseUrl}/o/headless-user-notification/v1.0/my-user-notifications?pageSize=100&sort=dateCreated:desc`;
      
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (accessToken) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }

      const response = await fetch(url, { method: 'GET', headers });
      if (!response.ok) {
        console.warn('[driverWorkflowService] Failed to fetch notifications, status:', response.status);
        return [];
      }
      
      const data = await response.json();
      const items = data.items || [];
      
      return items.map((item: any) => {
         let title = 'Notification';
         let message = '';
         
         if (item.payload) {
            try {
               const parsed = typeof item.payload === 'string' ? JSON.parse(item.payload) : item.payload;
               title = parsed.title || parsed.checkpointName || title;
               message = parsed.body || parsed.description || message;
               if (parsed.dispatchID && !parsed.title) {
                  title = `Dispatch #${parsed.dispatchID}`;
               }
            } catch (e) {}
         }
         
         if (!message && item.message) {
            // Fallback for HTML payloads in raw message
            const raw = item.message.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
            message = raw;
            if (raw.toLowerCase().includes('dispatch')) {
              title = 'Dispatch Update';
            }
         }

         let category: DriverNotificationCategory = 'trip';
         if (title.toLowerCase().includes('ncr') || message.toLowerCase().includes('ncr')) {
             category = 'compliance';
         } else if (title.toLowerCase().includes('dispatch')) {
             category = 'trip';
         }

         return {
            id: String(item.id),
            category,
            read: item.userNotificationDeliveryType === 0 ? false : true, // Just a fallback if 'read' or similar property doesn't exist
            title,
            message: message || 'You have a new notification.',
            timeAgo: item.dateCreated ? formatRelativeTime(item.dateCreated) : 'Just now',
         };
      });
    } catch (e) {
      console.warn('[driverWorkflowService] Failed to fetch notifications:', e);
      return [];
    }
  },

  async markAllNotificationsRead(): Promise<void> {
    return;
  },

  async getLiveTripTracking(): Promise<LiveTripTracking | null> {
    return null;
  },

  async getPodTripSummary(accessToken?: string): Promise<PodTripSummary | null> {
    try {
      return await driverPodService.getPodTripSummary({ accessToken });
    } catch {
      return null;
    }
  },

  async submitProofOfDelivery(params: SubmitProofOfDeliveryParams): Promise<PodSubmissionResult> {
    if (params.objectEntryId && params.photos && params.photos.length > 0) {
      return await driverPodService.submitPod({
        objectEntryId: params.objectEntryId,
        photos: params.photos,
        signed: params.signed,
        tripId: params.tripId,
        accessToken: params.accessToken,
      });
    }
    return {
      referenceId: 'SUBMITTED',
      eWayBillNumber: 'N/A',
      photosCount: params.photosCount,
    };
  },
};

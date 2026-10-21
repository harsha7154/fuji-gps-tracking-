/**
 * Title / message text for a Liferay notification — shared by
 * NotificationsScreen, the in-app toast and the system (OS) notifications.
 *
 * Works on the merged item from notificationService (headless list + JSONWS
 * payload): payload fields first, then the headless `message`.
 */
import type { LiferayNotification } from '../services/notificationService';
import { stripHtmlWithoutLinks } from './notificationLinkHelper';

type JsonObject = Record<string, unknown>;

/** payload / message may be an object, a JSON string, or plain text/HTML. */
const parseJsonObject = (value: unknown): JsonObject | null => {
    if (!value) return null;
    if (typeof value === 'object') return value as JsonObject;
    if (typeof value === 'string' && value.trim().startsWith('{')) {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' ? (parsed as JsonObject) : null;
        } catch {
            return null;
        }
    }
    return null;
};

/** First non-empty string among `keys` (HTML stripped). */
const pickText = (data: JsonObject | null, keys: string[]): string => {
    if (!data) return '';
    for (const key of keys) {
        const value = data[key];
        if (typeof value === 'string') {
            const text = stripHtmlWithoutLinks(value);
            if (text) return text;
        }
    }
    return '';
};

const BODY_KEYS = ['body', 'description', 'message', 'notificationMessage', 'content', 'text'];
const TITLE_KEYS = ['title', 'checkpointName', 'name', 'activityName', 'subject'];
const DEFAULT_MESSAGE = 'You have a new notification.';

/**
 * Get notification message.
 *
 * Same order as the previous driver notifications logic
 * (driverWorkflowService.getDriverNotifications), which displayed correctly:
 *   1. payload.body / payload.description / ...
 *   2. message — JSON (body / description / ...) or plain text / HTML (tags stripped)
 * Never returns an empty string.
 */
export const getNotificationText = (
    notification: LiferayNotification,
): string => {
    const fromPayload = pickText(parseJsonObject(notification.payload), BODY_KEYS);
    if (fromPayload) return fromPayload;

    const rawMessage = typeof notification.message === 'string' ? notification.message : '';
    const messageJson = parseJsonObject(rawMessage);
    if (messageJson) {
        const fromJson = pickText(messageJson, BODY_KEYS) || pickText(messageJson, TITLE_KEYS);
        if (fromJson) return fromJson;
    } else {
        const plain = stripHtmlWithoutLinks(rawMessage);
        if (plain) return plain;
    }

    return DEFAULT_MESSAGE;
};

/**
 * Get notification title.
 *
 *   payload.title / checkpointName / name / activityName
 *   -> same keys inside a JSON message
 *   -> "Dispatch #<dispatchID>" when only a dispatch id is present
 *   -> "Dispatch Update" when the text mentions a dispatch
 *   -> "Notification"
 */
export const getNotificationTitle = (
    notification: LiferayNotification,
): string => {
    const payload = parseJsonObject(notification.payload);
    const messageJson = parseJsonObject(notification.message);

    const title = pickText(payload, TITLE_KEYS) || pickText(messageJson, TITLE_KEYS);
    if (title) return title;

    const dispatchId = payload?.dispatchID ?? payload?.dispatchId ?? messageJson?.dispatchID ?? messageJson?.dispatchId;
    if (typeof dispatchId === 'string' || typeof dispatchId === 'number') {
        return `Dispatch #${dispatchId}`;
    }

    if (getNotificationText(notification).toLowerCase().includes('dispatch')) {
        return 'Dispatch Update';
    }

    return 'Notification';
};

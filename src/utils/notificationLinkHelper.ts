/**
 * Helpers for turning a Liferay notification into something tappable.
 *
 *  - stripHtml()              HTML message -> plain text for display
 *  - extractNotificationLink() finds a link in an <a href> tag, the payload,
 *                              or a navigable HATEOAS action
 *  - openNotificationUrl()    resolves relative links against the Liferay host
 *                              and opens them with the OS
 */
import { Linking } from 'react-native';

// Named HTML entities that show up in Liferay notification messages / payloads.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  raquo: '\u00BB', // »
  laquo: '\u00AB', // «
  rsaquo: '\u203A', // ›
  lsaquo: '\u2039', // ‹
  rarr: '\u2192', // →
  larr: '\u2190', // ←
  hellip: '\u2026', // …
  ndash: '\u2013', // –
  mdash: '\u2014', // —
  bull: '\u2022', // •
  middot: '\u00B7', // ·
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201C',
  rdquo: '\u201D',
  copy: '\u00A9',
  reg: '\u00AE',
  trade: '\u2122',
  deg: '\u00B0',
  times: '\u00D7',
  rupee: '\u20B9',
  inr: '\u20B9',
};

function decodeEntitiesOnce(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1] === 'x' || entity[1] === 'X'
        ? parseInt(entity.slice(2), 16)
        : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/** Decodes HTML entities, including double-encoded ones like "&amp;raquo;". */
export function decodeHtmlEntities(input: string): string {
  let text = input;
  for (let i = 0; i < 3; i++) {
    const next = decodeEntitiesOnce(text);
    if (next === text) break;
    text = next;
  }
  return text;
}

/** Removes tags, decodes HTML entities (&raquo; -> », &amp; -> &, &#8377; -> ₹ …) and collapses whitespace. */
export function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  const withoutTags = String(input)
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  return decodeHtmlEntities(withoutTags)
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Display text with <a href> links removed (their target becomes the Go button),
 * e.g. "Checkpoint approved. <a href=...>View Activity &raquo;</a>" -> "Checkpoint approved."
 * Falls back to the full text if removing the link would leave nothing.
 */
export function stripHtmlWithoutLinks(input: string | null | undefined): string {
  if (!input) return '';
  const withoutLinks = stripHtml(String(input).replace(/<a\b[^>]*\bhref\s*=[^>]*>[\s\S]*?<\/a>/gi, ' '));
  return withoutLinks || stripHtml(input);
}

/**
 * Button label without trailing arrows ("View Dispatch »" -> "View Dispatch"),
 * since the Go button already draws its own arrow icon.
 */
export function cleanActionLabel(label: string | null | undefined): string {
  return stripHtml(label)
    .replace(/[\s\u00BB\u203A\u2192>]+$/u, '')
    .replace(/^[\s\u00AB\u2039\u2190<]+/u, '')
    .trim();
}

export interface NotificationLink {
  url?: string;
  label?: string;
}

const PAYLOAD_URL_KEYS = ['actionUrl', 'url', 'link', 'href', 'entryURL', 'portletURL', 'redirect'];
const PAYLOAD_LABEL_KEYS = ['actionLabel', 'linkLabel', 'buttonLabel'];

// HATEOAS actions that are API operations, not pages to open.
const NON_NAVIGABLE_ACTIONS = new Set(['read', 'unread', 'delete', 'update', 'get', 'replace']);

function parsePayload(payload: unknown): Record<string, unknown> | null {
  if (!payload) return null;
  if (typeof payload === 'object') return payload as Record<string, unknown>;
  if (typeof payload === 'string') {
    try {
      const parsed = JSON.parse(payload);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** First <a href="...">label</a> in an HTML string. */
function linkFromHtml(html: string | undefined): NotificationLink {
  if (!html) return {};
  const match = html.match(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (!match) return {};
  const url = decodeHtmlEntities(match[1]).trim();
  const label = cleanActionLabel(match[2]);
  return { url: url || undefined, label: label || undefined };
}

export function extractNotificationLink(
  message?: string,
  payload?: unknown,
  actions?: Record<string, { href?: string; method?: string } | undefined>,
): NotificationLink {
  // 1. <a href> inside the message (or inside a JSON message's body).
  const fromMessage = linkFromHtml(message);
  if (fromMessage.url) return fromMessage;

  if (message && message.trim().startsWith('{')) {
    const parsedMessage = parsePayload(message);
    if (parsedMessage) {
      for (const key of ['body', 'message', 'notificationMessage']) {
        const value = parsedMessage[key];
        if (typeof value === 'string') {
          const link = linkFromHtml(value);
          if (link.url) return link;
        }
      }
      const fromJson = linkFromObject(parsedMessage);
      if (fromJson.url) return fromJson;
    }
  }

  // 2. Payload fields.
  const data = parsePayload(payload);
  if (data) {
    const fromPayload = linkFromObject(data);
    if (fromPayload.url) return fromPayload;
    for (const key of ['body', 'message']) {
      const value = data[key];
      if (typeof value === 'string') {
        const link = linkFromHtml(value);
        if (link.url) return link;
      }
    }
  }

  // 3. A navigable HATEOAS action (GET, not an API verb like read/delete).
  if (actions) {
    for (const [name, action] of Object.entries(actions)) {
      if (!action?.href || NON_NAVIGABLE_ACTIONS.has(name.toLowerCase())) continue;
      const method = (action.method ?? 'GET').toUpperCase();
      if (method !== 'GET' || action.href.includes('/o/headless-')) continue;
      return { url: action.href, label: undefined };
    }
  }

  return {};
}

function linkFromObject(data: Record<string, unknown>): NotificationLink {
  const url = PAYLOAD_URL_KEYS.map((k) => data[k]).find(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  );
  if (!url) return {};
  const label = PAYLOAD_LABEL_KEYS.map((k) => data[k]).find(
    (v): v is string => typeof v === 'string' && v.trim() !== '',
  );
  return { url: decodeHtmlEntities(url).trim(), label: label ? cleanActionLabel(label) || undefined : undefined };
}

/** Makes a relative link absolute against the Liferay host. Returns null if unusable. */
export function resolveNotificationUrl(url: string, baseUrl?: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null; // javascript:, data:, intent: … not allowed
  if (!baseUrl) return null;
  const base = baseUrl.replace(/\/+$/, '');
  return trimmed.startsWith('/') ? `${base}${trimmed}` : `${base}/${trimmed}`;
}

export async function openNotificationUrl(url: string, baseUrl?: string): Promise<void> {
  const resolved = resolveNotificationUrl(url, baseUrl);
  if (!resolved) {
    console.warn('[notificationLinkHelper] Ignoring unsupported link:', url);
    return;
  }
  try {
    await Linking.openURL(resolved);
  } catch (err) {
    console.warn('[notificationLinkHelper] Could not open link:', resolved, err);
  }
}

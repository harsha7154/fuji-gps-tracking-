/**
 * The signed-in user's full Liferay profile.
 *
 *   GET {base}/o/headless-admin-user/v1.0/my-user-account
 *
 * Returns everything maintained on the user in Liferay (Control Panel → Users,
 * or My Account): name parts, job title, birthday, photo, phones, addresses,
 * extra emails, websites, social ids, organizations, sites, user groups,
 * roles and custom fields (e.g. licence number if the admin added that field).
 *
 * `toLiferayProfile()` flattens the raw response into what the Profile screen
 * shows; empty values are dropped so the screen only renders real data.
 */
import { apiClient, getBaseUrl, requestWithTokenRefresh } from '../api/client';
import type { TokenRefreshHandler } from './notificationService';

// ───────────── raw Liferay shapes (only the fields we read) ─────────────

interface Brief {
  id?: number;
  name?: string;
  key?: string;
}

interface RawUserAccount {
  id: number;
  name?: string;
  givenName?: string;
  additionalName?: string;
  familyName?: string;
  honorificPrefix?: string;
  honorificSuffix?: string;
  alternateName?: string;
  emailAddress?: string;
  jobTitle?: string;
  birthDate?: string;
  gender?: string;
  languageId?: string;
  languageDisplayName?: string;
  status?: string;
  dateCreated?: string;
  dateModified?: string;
  lastLoginDate?: string;
  image?: string;
  externalReferenceCode?: string;
  roleBriefs?: Brief[];
  organizationBriefs?: Brief[];
  siteBriefs?: Brief[];
  userGroupBriefs?: Brief[];
  customFields?: Array<{
    name?: string;
    dataType?: string;
    customValue?: { data?: unknown };
  }>;
  userAccountContactInformation?: {
    emailAddresses?: Array<{ emailAddress?: string; type?: string; primary?: boolean }>;
    telephones?: Array<{ phoneNumber?: string; extension?: string; phoneType?: string; primary?: boolean }>;
    postalAddresses?: Array<{
      streetAddressLine1?: string;
      streetAddressLine2?: string;
      streetAddressLine3?: string;
      addressLocality?: string;
      addressRegion?: string;
      postalCode?: string;
      addressCountry?: string;
      addressType?: string;
      primary?: boolean;
    }>;
    webUrls?: Array<{ url?: string; urlType?: string; primary?: boolean }>;
    facebook?: string;
    twitter?: string;
    skype?: string;
    jabber?: string;
    sms?: string;
  };
}

// ───────────── flattened profile used by the UI ─────────────

export interface ProfileContact {
  /** e.g. "Mobile", "Business", "Personal" */
  label: string;
  value: string;
  primary?: boolean;
  /** tel: / mailto: / https: link, when tapping it makes sense */
  link?: string;
}

export interface LiferayProfile {
  id: string;
  displayName: string;
  givenName?: string;
  familyName?: string;
  screenName?: string;
  email?: string;
  jobTitle?: string;
  birthDate?: string;
  gender?: string;
  language?: string;
  status?: string;
  dateCreated?: string;
  dateModified?: string;
  lastLoginDate?: string;
  imageUrl?: string;
  externalReferenceCode?: string;
  phones: ProfileContact[];
  emails: ProfileContact[];
  addresses: ProfileContact[];
  websites: ProfileContact[];
  social: ProfileContact[];
  organizations: string[];
  sites: string[];
  userGroups: string[];
  roles: string[];
  customFields: { label: string; value: string }[];
}

const clean = (v: unknown): string | undefined => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s === '' ? undefined : s;
};

/** "mobile-phone" / "businessPhone" -> "Mobile Phone" / "Business Phone" */
const humanize = (v?: string): string | undefined =>
  v
    ? v
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .replace(/[-_.]+/g, ' ')
        .trim()
        .replace(/\b\w/g, (c) => c.toUpperCase())
    : undefined;

const names = (briefs?: Brief[]): string[] =>
  Array.from(new Set((briefs ?? []).map((b) => clean(b.name) ?? clean(b.key)).filter((n): n is string => !!n)));

const byPrimaryFirst = <T extends { primary?: boolean }>(list: T[]): T[] =>
  [...list].sort((a, b) => Number(!!b.primary) - Number(!!a.primary));

function customValueToText(data: unknown): string | undefined {
  if (data === null || data === undefined) return undefined;
  if (Array.isArray(data)) return clean(data.map((d) => customValueToText(d)).filter(Boolean).join(', '));
  if (typeof data === 'boolean') return data ? 'Yes' : 'No';
  if (typeof data === 'object') {
    // Localized values come as { en_US: "..." }
    const values = Object.values(data as Record<string, unknown>).map((d) => customValueToText(d));
    return clean(values.filter(Boolean)[0]);
  }
  return clean(data);
}

function imageUrl(path?: string): string | undefined {
  const p = clean(path);
  if (!p) return undefined;
  if (/^https?:\/\//i.test(p)) return p;
  return `${apiClient.baseUrl}${p.startsWith('/') ? '' : '/'}${p}`;
}

export function toLiferayProfile(raw: RawUserAccount): LiferayProfile {
  const contact = raw.userAccountContactInformation ?? {};

  const displayName =
    clean([raw.honorificPrefix, raw.name ?? [raw.givenName, raw.additionalName, raw.familyName].filter(Boolean).join(' '), raw.honorificSuffix].filter(Boolean).join(' ')) ??
    clean(raw.alternateName) ??
    clean(raw.emailAddress) ??
    'User';

  const phones = byPrimaryFirst(contact.telephones ?? [])
    .filter((t) => clean(t.phoneNumber))
    .map((t) => ({
      label: humanize(t.phoneType) ?? 'Phone',
      value: `${t.phoneNumber!.trim()}${clean(t.extension) ? ` ext. ${t.extension!.trim()}` : ''}`,
      primary: t.primary,
      link: `tel:${t.phoneNumber!.replace(/[^\d+]/g, '')}`,
    }));

  const emails = byPrimaryFirst(contact.emailAddresses ?? [])
    .filter((e) => clean(e.emailAddress) && e.emailAddress!.trim().toLowerCase() !== raw.emailAddress?.trim().toLowerCase())
    .map((e) => ({
      label: humanize(e.type) ?? 'Email',
      value: e.emailAddress!.trim(),
      primary: e.primary,
      link: `mailto:${e.emailAddress!.trim()}`,
    }));

  const addresses = byPrimaryFirst(contact.postalAddresses ?? [])
    .map((a) => ({
      label: humanize(a.addressType) ?? 'Address',
      value:
        clean(
          [
            a.streetAddressLine1,
            a.streetAddressLine2,
            a.streetAddressLine3,
            [a.addressLocality, a.addressRegion].filter((x) => clean(x)).join(', '),
            [a.postalCode, a.addressCountry].filter((x) => clean(x)).join(' '),
          ]
            .map((x) => clean(x))
            .filter(Boolean)
            .join(', '),
        ) ?? '',
      primary: a.primary,
    }))
    .filter((a) => a.value);

  const websites = byPrimaryFirst(contact.webUrls ?? [])
    .filter((w) => clean(w.url))
    .map((w) => ({
      label: humanize(w.urlType) ?? 'Website',
      value: w.url!.trim(),
      primary: w.primary,
      link: /^https?:\/\//i.test(w.url!.trim()) ? w.url!.trim() : `https://${w.url!.trim()}`,
    }));

  const social = (
    [
      ['SMS', contact.sms],
      ['Skype', contact.skype],
      ['Facebook', contact.facebook],
      ['Twitter / X', contact.twitter],
      ['Jabber', contact.jabber],
    ] as const
  )
    .filter(([, v]) => clean(v))
    .map(([label, v]) => ({ label, value: v!.trim() }));

  const customFields = (raw.customFields ?? [])
    .map((f) => ({ label: humanize(f.name) ?? '', value: customValueToText(f.customValue?.data) ?? '' }))
    .filter((f) => f.label && f.value);

  return {
    id: String(raw.id),
    displayName,
    givenName: clean(raw.givenName),
    familyName: clean(raw.familyName),
    screenName: clean(raw.alternateName),
    email: clean(raw.emailAddress),
    jobTitle: clean(raw.jobTitle),
    birthDate: clean(raw.birthDate),
    gender: humanize(clean(raw.gender)),
    language: clean(raw.languageDisplayName) ?? clean(raw.languageId)?.replace('_', '-'),
    status: clean(raw.status),
    dateCreated: clean(raw.dateCreated),
    dateModified: clean(raw.dateModified),
    lastLoginDate: clean(raw.lastLoginDate),
    imageUrl: imageUrl(raw.image),
    externalReferenceCode: clean(raw.externalReferenceCode),
    phones,
    emails,
    addresses,
    websites,
    social,
    organizations: names(raw.organizationBriefs),
    sites: names(raw.siteBriefs),
    userGroups: names(raw.userGroupBriefs),
    roles: names(raw.roleBriefs),
    customFields,
  };
}

export const liferayProfileService = {
  /** Throws on network / HTTP failure. */
  async getMyProfile(
    accessToken: string,
    refreshToken: string,
    onTokenRefresh?: TokenRefreshHandler,
  ): Promise<LiferayProfile> {
    const url = `${getBaseUrl()}/o/headless-admin-user/v1.0/my-user-account`;
    const { response } = await requestWithTokenRefresh(
      url,
      accessToken,
      refreshToken,
      { method: 'GET', headers: { Accept: 'application/json' } },
      onTokenRefresh,
    );
    if (!response.ok) {
      const error = new Error(`Load profile failed with status ${response.status}`);
      (error as any).status = response.status;
      throw error;
    }
    const raw = (await response.json()) as RawUserAccount;
    return toLiferayProfile(raw);
  },
};

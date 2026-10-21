/**
 * Role lookup helpers for the Liferay Headless Admin User API.
 *
 * Used by authService right after login: the login flow already knows the
 * user's numeric id, and GET /user-accounts/{id} returns the full
 * `roleBriefs` list (e.g. [{key:"User"}, {key:"driver"}]).
 *
 * Kept in its own file (not client.ts) on purpose so it can be dropped in
 * without touching the rest of the API client. Every function here NEVER
 * throws — on any failure it logs the reason and returns null, so a failed
 * lookup on one endpoint never blocks the others.
 */
import { fetchWithTimeout, getBaseUrl } from './client';
import { LIFERAY_ROLE_KEYS } from '../types/auth';
import type { UserRole } from '../types/auth';

export interface RoleBrief {
  id?: number;
  key: string;
  name?: string;
  roleType?: number;
  externalReferenceCode?: string;
}

const ROLE_REQUEST_TIMEOUT_MS = 15000;

export function summarizeRoles(roles: RoleBrief[] | null | undefined): string {
  if (!roles || roles.length === 0) return '(none)';
  return roles.map((r) => `${r.key}${r.name && r.name !== r.key ? `/${r.name}` : ''}`).join(', ');
}

async function getRoleBriefs(label: string, path: string, accessToken: string): Promise<RoleBrief[] | null> {
  const url = `${getBaseUrl()}${path}`;
  try {
    console.log(`[ROLE-API] ${label} GET`, url);
    const response = await fetchWithTimeout(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      }, ROLE_REQUEST_TIMEOUT_MS);
    console.log(`[ROLE-API] ${label} status:`, response.status);

    if (!response.ok) {
      let bodyText = '';
      try {
        bodyText = (await response.text()).slice(0, 300);
      } catch {
        // ignore
      }
      console.warn(
        `[ROLE-API] ${label} FAILED — http ${response.status}. ` +
          (response.status === 403
            ? "403 = the OAuth2 client/user is not allowed to read this account (check the client's Liferay.Headless.Admin.User scopes). "
            : '') +
          bodyText
      );
      return null;
    }

    const data = await response.json();
    const roles: RoleBrief[] = Array.isArray(data?.roleBriefs) ? data.roleBriefs : [];
    console.log(`[ROLE-API] ${label} roleBriefs:`, summarizeRoles(roles));
    return roles;
  } catch (err: any) {
    console.warn(`[ROLE-API] ${label} threw:`, err?.message ?? err);
    return null;
  }
}

/** GET /o/headless-admin-user/v1.0/user-accounts/{userId} */
export function fetchRoleBriefsByUserId(accessToken: string, userId: number | string): Promise<RoleBrief[] | null> {
  return getRoleBriefs(
    'by-id',
    `/o/headless-admin-user/v1.0/user-accounts/${encodeURIComponent(String(userId))}`,
    accessToken
  );
}

/** GET /o/headless-admin-user/v1.0/my-user-account (the token's own user) */
export function fetchMyRoleBriefs(accessToken: string): Promise<RoleBrief[] | null> {
  return getRoleBriefs('my-account', '/o/headless-admin-user/v1.0/my-user-account', accessToken);
}

// ---------------------------------------------------------------------------
// Role resolution (single entry point used by authService.realLogin)
// ---------------------------------------------------------------------------

// INTERNAL-TESTING SWITCH. Liferay currently returns only the default "User"
// role to the app's own token (the "driver" / "Site Engineer" roles are only
// visible to an admin), so without this a release APK can never resolve a
// role. While true, an account with no matching role is let in as the role
// the person tapped on the Splash screen. That trusts the client — set this
// to false as soon as Liferay returns the real roles to the app's token.
export const ALLOW_ROLE_FALLBACK = true;

/**
 * Role used by the fallback above when no role was pre-selected (the splash
 * no longer has a role picker): accounts with only Liferay's default "User"
 * role log in as Truck Driver.
 */
export const DEFAULT_FALLBACK_ROLE: UserRole = 'TRUCK_DRIVER';

function normRole(value?: string): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Liferay's default role on every account — never counts as an app role. */
function isDefaultUserRole(r: RoleBrief): boolean {
  return r.externalReferenceCode === 'L_USER' || normRole(r.key) === 'user';
}

function mergeRoles(target: RoleBrief[], extra: RoleBrief[] | null): void {
  if (!extra) return;
  const have = new Set(target.map((r) => normRole(r.key)));
  extra.forEach((r) => {
    if (!have.has(normRole(r.key))) {
      target.push(r);
      have.add(normRole(r.key));
    }
  });
}

function matchAppRoles(roles: RoleBrief[]): UserRole[] {
  const candidates = roles.filter((r) => !isDefaultUserRole(r));
  const seen = new Set<string>();
  candidates.forEach((r) => {
    seen.add(normRole(r.key));
    seen.add(normRole(r.name));
  });
  return (Object.keys(LIFERAY_ROLE_KEYS) as UserRole[]).filter((role) =>
    seen.has(normRole(LIFERAY_ROLE_KEYS[role]))
  );
}

/**
 * Decide the app role for a just-logged-in Liferay account.
 * Reads roleBriefs from (1) the account already fetched, (2) GET
 * /user-accounts/{id}, (3) GET /my-user-account; skips the default "User"
 * role; matches "driver" -> TRUCK_DRIVER and "Site Engineer" ->
 * SITE_ENGINEER. Throws Error('ACCESS_DENIED') (status 403, .detail set) if
 * nothing matches and the fallback is off.
 */
export async function resolveAppRole(params: {
  accessToken: string;
  account: { id: number | string; emailAddress?: string; roleBriefs?: RoleBrief[] };
  expectedRole?: UserRole;
}): Promise<UserRole> {
  const { accessToken, account, expectedRole } = params;
  console.log('[ROLE] login ok — userId:', account.id, ' email:', account.emailAddress, ' expectedRole:', expectedRole);

  const roles: RoleBrief[] = [];
  mergeRoles(roles, account.roleBriefs ?? []);
  console.log('[ROLE] by-email roleBriefs:', summarizeRoles(roles));

  mergeRoles(roles, await fetchRoleBriefsByUserId(accessToken, account.id));
  let matched = matchAppRoles(roles);

  if (matched.length === 0) {
    console.warn('[ROLE] no app role yet — trying /my-user-account');
    mergeRoles(roles, await fetchMyRoleBriefs(accessToken));
    matched = matchAppRoles(roles);
  }

  console.log(
    '[ROLE] all roles:', summarizeRoles(roles),
    '| ignoring default "User" | matched app roles:', matched.length ? matched.join(', ') : '(none)'
  );

  let resolved: UserRole | undefined =
    expectedRole && matched.includes(expectedRole) ? expectedRole : matched[0];

  if (!resolved && (__DEV__ || ALLOW_ROLE_FALLBACK)) {
    const fallbackRole = expectedRole ?? DEFAULT_FALLBACK_ROLE;
    console.warn(
      '[ROLE] FALLBACK: Liferay returned no driver/Site Engineer role for this token; letting the user in as',
      fallbackRole,
      expectedRole ? '(selected role)' : '(default fallback role)',
      '(ALLOW_ROLE_FALLBACK / __DEV__).'
    );
    resolved = fallbackRole;
  }

  if (!resolved) {
    console.warn('[ROLE] ACCESS DENIED — have:', summarizeRoles(roles), '| need one of:', Object.values(LIFERAY_ROLE_KEYS));
    const error = new Error('ACCESS_DENIED');
    (error as any).status = 403;
    (error as any).detail = `Roles found: ${summarizeRoles(roles)}`;
    throw error;
  }

  console.log('[ROLE] resolved role:', resolved);
  return resolved;
}

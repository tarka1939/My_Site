import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  API_BASE,
  E2E_ADMIN_PASSWORD,
  E2E_ADMIN_USERNAME,
  E2E_EMAIL_DOMAIN,
  E2E_TITLE_PREFIX,
  TOKEN_FILE,
} from './env';

/**
 * Thin client over the real HTTP API, used for fixture seeding, assertions about persisted
 * state, and cleanup. Deliberately hand-written rather than reusing the frontend's generated
 * client: this suite is checking the contract from the outside, so it should not share code
 * with one of the two sides it is testing.
 *
 * Shapes below follow `docs/openapi.yaml`, and being a hand-written mirror is exactly why they
 * have to be kept level with it by hand: this is the contract's *third* implementation, alongside
 * the backend DTOs and the generated Angular client, and the only one no tool will regenerate.
 * A field added to the contract but not to these interfaces makes the suite silently stop
 * covering it -- and makes adding a fixture for it a type error in the file that claims to be
 * the contract.
 */

export interface Tag {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  title: string;
  description: string;
  links: { label: string; url: string }[];
  images: string[];
  tags: Tag[];
  /**
   * `format: date` (`YYYY-MM-DD`). Null means the start is unspecified.
   *
   * Optional, not merely nullable, because `Project.required` in the contract lists neither date
   * -- so a conforming server may omit the key entirely. The backend always sends it (Jackson's
   * default inclusion), but this mirror follows what is promised rather than what is observed;
   * asserting more than the contract says is how a suite ends up pinning an accident.
   */
  startedOn?: string | null;
  /** `format: date`, same optionality. **Null means ongoing** -- a value, not missing data. */
  completedOn?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContactMessage {
  id: string;
  name: string;
  email: string;
  message: string;
  createdAt: string;
}

interface PageResponse<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
}

export interface ProjectWriteRequest {
  title: string;
  description: string;
  tags: string[];
  links?: { label: string; url: string }[];
  images?: string[];
  /** `format: date`. Omitting it on a PUT clears the stored value -- PUT is a full replacement. */
  startedOn?: string | null;
  /** `format: date`. Null (or omitted) is what makes a project ongoing rather than undated. */
  completedOn?: string | null;
}

interface LoginResponse {
  token: string;
  expiresAt: string;
}

async function request<T>(
  path: string,
  init: RequestInit & { token?: string; expectStatus?: number } = {},
): Promise<T> {
  const { token, expectStatus, headers, ...rest } = init;
  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (expectStatus !== undefined ? response.status !== expectStatus : !response.ok) {
    const body = await response.text();
    throw new Error(
      `${rest.method ?? 'GET'} ${path} -> ${response.status} ${response.statusText}\n${body}`,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

export async function login(
  username = E2E_ADMIN_USERNAME,
  password = E2E_ADMIN_PASSWORD,
): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

/**
 * Returns a usable admin JWT, caching it for the rest of the run.
 *
 * The cache is per-run, not across runs: `teardown` deletes it (see {@link discardCachedToken}),
 * because an admin token that outlives the account it was minted for is a live credential
 * sitting on disk. That costs the suite one login per run on top of the admin journey's real UI
 * login — two of `AuthService`'s five-per-15-minutes budget — which is the deliberate trade.
 *
 * The reuse path still matters *within* a run, and it revalidates against the API before
 * trusting what it read, so a backend restarted mid-run or a rotated secret falls back to a
 * fresh login instead of failing somewhere less obvious.
 */
export async function acquireToken(): Promise<string> {
  const cached = await readCachedToken();
  if (cached && (await tokenStillWorks(cached))) {
    return cached;
  }

  let response: LoginResponse;
  try {
    response = await login();
  } catch (error) {
    // The login budget is this suite's scarcest resource, and a bare "-> 429 Too Many Requests"
    // says nothing about what to do next. AuthService counts the attempt *before* it checks the
    // credentials, so failed attempts cost exactly as much as successful ones.
    if (error instanceof Error && error.message.includes('429')) {
      throw new Error(
        `${error.message}\n` +
          `AuthService allows 5 login attempts per 15 minutes per IP and this suite spends 2 per ` +
          `run (this one, plus the admin journey's real UI login), so roughly the 3rd run inside ` +
          `a window hits this. The limiter is in-memory: restart the backend to clear it, or ` +
          `wait out the window.`,
        { cause: error },
      );
    }
    throw error;
  }

  await writeCachedToken(response.token, response.expiresAt);
  return response.token;
}

/** Reads the token cached by `setup`. Throws rather than logging in again, so an accidental
 *  extra login can never silently eat into the rate-limit budget mid-run. */
export async function requireCachedToken(): Promise<string> {
  const cached = await readCachedToken();
  if (!cached) {
    throw new Error(
      `No cached admin token at ${TOKEN_FILE}. The "setup" project must run before this ` +
        `(check that it was not skipped with --grep / --project).`,
    );
  }
  return cached;
}

async function readCachedToken(): Promise<string | null> {
  try {
    const raw = await readFile(TOKEN_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { token: string; expiresAt: string };
    // 5 minute safety margin so a token cannot expire partway through a run.
    if (Date.parse(parsed.expiresAt) - Date.now() < 5 * 60 * 1000) {
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

async function writeCachedToken(token: string, expiresAt: string): Promise<void> {
  await mkdir(dirname(TOKEN_FILE), { recursive: true });
  // Unlink before writing: `mode` only applies when `writeFile` *creates* the file, so writing
  // over a token cached by an older version of this code would silently keep its 0644.
  await rm(TOKEN_FILE, { force: true });
  await writeFile(TOKEN_FILE, JSON.stringify({ token, expiresAt }, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
  });
}

/**
 * Deletes the cached admin JWT. Called by `teardown`, unconditionally, alongside removing the
 * `e2e-admin` row.
 *
 * Both halves are needed, and deleting the row is the weaker of the two. `SecurityConfig`
 * configures a stateless resource server whose authorities come from the token's `roles` claim;
 * `AdminUserRepository` is consulted at login and never again. So a token minted before the row
 * was deleted keeps working for the rest of its hour — meaning that without this, the account
 * was cleaned up but the credential that actually grants admin write access stayed on disk.
 *
 * Idempotent (`force: true`), so it is safe in a teardown path that must not add failures of
 * its own.
 */
export async function discardCachedToken(): Promise<void> {
  await rm(TOKEN_FILE, { force: true });
}

async function tokenStillWorks(token: string): Promise<boolean> {
  const response = await fetch(`${API_BASE}/contact-messages?page=0&size=1`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return response.ok;
}

export async function createProject(token: string, body: ProjectWriteRequest): Promise<Project> {
  return request<Project>('/projects', {
    method: 'POST',
    token,
    body: JSON.stringify({ links: [], images: [], ...body }),
    expectStatus: 201,
  });
}

export async function deleteProject(token: string, id: string): Promise<void> {
  await request<void>(`/projects/${id}`, { method: 'DELETE', token, expectStatus: 204 });
}

export async function listProjectsByTag(tag: string): Promise<Project[]> {
  return collectPages((page) => request<PageResponse<Project>>(`/projects?page=${page}&size=100&tag=${encodeURIComponent(tag)}`));
}

export async function listAllProjects(): Promise<Project[]> {
  return collectPages((page) => request<PageResponse<Project>>(`/projects?page=${page}&size=100`));
}

export async function listAllContactMessages(token: string): Promise<ContactMessage[]> {
  return collectPages((page) =>
    request<PageResponse<ContactMessage>>(`/contact-messages?page=${page}&size=100`, { token }),
  );
}

export async function deleteContactMessage(token: string, id: string): Promise<void> {
  await request<void>(`/contact-messages/${id}`, { method: 'DELETE', token, expectStatus: 204 });
}

async function collectPages<T>(fetchPage: (page: number) => Promise<PageResponse<T>>): Promise<T[]> {
  const first = await fetchPage(0);
  const all = [...first.content];
  for (let page = 1; page < first.totalPages; page++) {
    all.push(...(await fetchPage(page)).content);
  }
  return all;
}

/**
 * Deletes every contact message this suite created, matched by the reserved `.invalid` email
 * domain in `support/env.ts` — never anything a developer submitted by hand.
 *
 * **This frees the contact form's rate-limit window only partially, and the distinction
 * matters.** `ContactService` does derive the limit from a `count(*)` over `contact_message`
 * rather than from in-memory state, so deleting rows does move the counter — but it counts by
 * `requester_ip_hash`, not by email:
 *
 * ```java
 * countByRequesterIpHashAndCreatedAtAfter(ipHash, Instant.now().minus(RATE_LIMIT_WINDOW))
 * ```
 *
 * So this reclaims the slots *this suite* used, and nothing else. A message a developer
 * submitted by hand from the same machine inside the trailing hour still occupies a slot, and
 * no purge that stays inside the suite's own namespace can reclaim it. Widening the match would
 * mean deleting a developer's real data, which is not a trade this suite gets to make — so the
 * rate-limit journey asserts the precondition explicitly instead (see `tests/contact.spec.ts`).
 *
 * Deliberately narrower than {@link purgeE2eData}: the contact journeys call this between
 * tests, and must not take the seeded fixture projects with them.
 */
export async function purgeE2eContactMessages(token: string): Promise<number> {
  const messages = (await listAllContactMessages(token)).filter((m) =>
    m.email.endsWith(E2E_EMAIL_DOMAIN),
  );
  for (const message of messages) {
    await deleteContactMessage(token, message.id);
  }
  return messages.length;
}

/**
 * Deletes this suite's projects carrying `tag`. Scoped to one tag so a journey can reset just
 * the rows it owns without disturbing the fixture projects the other journeys assert against.
 *
 * Still filtered by title prefix as well as by tag: the tag alone is namespaced by convention,
 * the prefix is what actually keeps a developer's own project out of a DELETE loop.
 */
export async function purgeE2eProjectsByTag(token: string, tag: string): Promise<number> {
  const projects = (await listProjectsByTag(tag)).filter((p) =>
    p.title.startsWith(E2E_TITLE_PREFIX),
  );
  for (const project of projects) {
    await deleteProject(token, project.id);
  }
  return projects.length;
}

/** Deletes every project this suite created, matched by title prefix. */
export async function purgeE2eProjects(token: string): Promise<number> {
  const projects = (await listAllProjects()).filter((p) => p.title.startsWith(E2E_TITLE_PREFIX));
  for (const project of projects) {
    await deleteProject(token, project.id);
  }
  return projects.length;
}

/**
 * Full cleanup — everything this suite could have created. Only for `setup` and `teardown`.
 *
 * Run before seeding as well as after the suite: a run that crashed before teardown must not be
 * able to poison the next one.
 */
export async function purgeE2eData(token: string): Promise<{ projects: number; messages: number }> {
  return {
    projects: await purgeE2eProjects(token),
    messages: await purgeE2eContactMessages(token),
  };
}

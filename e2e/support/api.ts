import { mkdir, readFile, writeFile } from 'node:fs/promises';
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
 * Shapes below follow `docs/openapi.yaml`.
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
 * Returns a usable admin JWT, reusing the one cached by a previous run when it is still valid.
 *
 * This is not premature optimization — `AuthService` rate-limits login to 5 attempts per
 * 15 minutes per IP, so a suite that logs in unconditionally on every run would start failing
 * with a 429 after a couple of consecutive runs. Caching keeps the Node-side cost at zero for
 * back-to-back runs and leaves the whole budget for the UI login the admin journey performs
 * for real. The cached token is validated against the API before being trusted, so a restarted
 * backend or a rotated secret falls back to a fresh login instead of failing mid-suite.
 */
export async function acquireToken(): Promise<string> {
  const cached = await readCachedToken();
  if (cached && (await tokenStillWorks(cached))) {
    return cached;
  }
  const { token, expiresAt } = await login();
  await writeCachedToken(token, expiresAt);
  return token;
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
  await writeFile(TOKEN_FILE, JSON.stringify({ token, expiresAt }, null, 2), 'utf8');
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
 * Doubles as the reset for the contact form's rate limit: `ContactService` derives it from a
 * `count(*)` over `contact_message` rows in the trailing hour, not from in-memory state, so
 * deleting the rows frees the window again.
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

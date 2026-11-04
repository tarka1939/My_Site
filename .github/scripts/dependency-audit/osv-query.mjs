/**
 * Looks the backend's resolved Maven graph up in OSV (https://osv.dev). Part of #273.
 *
 *   node .github/scripts/dependency-audit/osv-query.mjs <dependency-list.txt> <out.json>
 *
 * The input is what `mvn dependency:list -DoutputFile=...` writes, so the versions are the ones
 * Maven actually resolved, including every one Spring Boot's BOM manages and the overrides in
 * backend/pom.xml. pom.xml alone names almost none of them.
 *
 * Why OSV: it needs no account and no key. OWASP dependency-check needs an NVD key to be usable,
 * and Sonatype OSS Index now needs credentials. OSV's Maven data is GitHub's advisory database,
 * matched with Maven's own version ordering, so a BOM-managed version is checked exactly.
 *
 * Always writes <out.json>: `{ source, queriedAt, packages: [{ name, version, scopes, ids }],
 * vulns: { id: record } }` on success, or `{ error }` on any failure, with exit code 1. report.mjs
 * reads either and is the step that fails the run, after writing the summary.
 *
 * OSV_API_BASE overrides https://api.osv.dev. The tests use it to produce a real network failure.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { isMain, osvPackages, parseMavenDependencyList, trimOsvRecord } from './lib.mjs';

const DEFAULT_BASE = 'https://api.osv.dev';

/** `fetch` reports every transport failure as a bare "fetch failed"; the cause has the detail. */
function describe(error) {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause instanceof Error ? error.cause.message || error.cause.code : error.cause?.code;
  return cause ? `${error.message} (${cause})` : error.message;
}

/**
 * One JSON request, retried twice on a network error, a 5xx or a 429. A 4xx other than 429 is
 * not retried: the same request will get the same answer.
 */
async function requestJson(url, init, { fetchImpl, sleep, attempts = 3, timeoutMs = 30000 }) {
  const what = `${init?.method ?? 'GET'} ${url}`;
  for (let attempt = 1; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      if (attempt >= attempts) throw new Error(`${what} failed after ${attempts} attempts: ${describe(error)}`);
      await sleep(2000 * attempt);
      continue;
    }
    if (response.ok) {
      try {
        return await response.json();
      } catch {
        throw new Error(`${what} returned HTTP ${response.status} with a body that is not JSON.`);
      }
    }
    const text = await response.text().catch(() => '');
    const retryable = response.status >= 500 || response.status === 429;
    if (!retryable || attempt >= attempts) {
      throw new Error(`${what} returned HTTP ${response.status}: ${text.replace(/\s+/g, ' ').slice(0, 200)}`);
    }
    await sleep(2000 * attempt);
  }
}

/**
 * Queries OSV for every package, following `next_page_token` until each query is complete, then
 * fetches each distinct advisory once. Any failure throws: a partial answer must not be written
 * as if it were the whole one.
 *
 * @param {{ name: string, version: string, scopes: string[] }[]} packages
 */
export async function queryOsv(
  packages,
  { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), base = DEFAULT_BASE, batchSize = 1000, concurrency = 8 } = {},
) {
  const ids = packages.map(() => new Set());
  let pending = packages.map((_, index) => ({ index, pageToken: undefined }));
  for (let round = 1; pending.length; round++) {
    if (round > 50) throw new Error('OSV kept returning more pages after 50 rounds; giving up rather than loop.');
    const next = [];
    for (let start = 0; start < pending.length; start += batchSize) {
      const chunk = pending.slice(start, start + batchSize);
      const queries = chunk.map(({ index, pageToken }) => ({
        package: { ecosystem: 'Maven', name: packages[index].name },
        version: packages[index].version,
        ...(pageToken ? { page_token: pageToken } : {}),
      }));
      const answer = await requestJson(
        `${base}/v1/querybatch`,
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ queries }) },
        { fetchImpl, sleep },
      );
      if (!Array.isArray(answer?.results) || answer.results.length !== chunk.length) {
        throw new Error(`OSV answered ${answer?.results?.length ?? 'no'} results for ${chunk.length} queries.`);
      }
      answer.results.forEach((result, k) => {
        for (const vuln of result?.vulns ?? []) {
          if (typeof vuln?.id !== 'string') throw new Error('OSV returned an advisory without an id.');
          ids[chunk[k].index].add(vuln.id);
        }
        if (result?.next_page_token) next.push({ index: chunk[k].index, pageToken: result.next_page_token });
      });
    }
    pending = next;
  }

  const allIds = [...new Set(ids.flatMap((s) => [...s]))].sort();
  const names = new Set(packages.map((p) => p.name));
  const vulns = {};
  let cursor = 0;
  const worker = async () => {
    while (cursor < allIds.length) {
      const id = allIds[cursor++];
      const record = await requestJson(`${base}/v1/vulns/${encodeURIComponent(id)}`, { method: 'GET' }, { fetchImpl, sleep });
      if (typeof record?.id !== 'string') throw new Error(`OSV's record for ${id} has no id.`);
      vulns[id] = trimOsvRecord(record, names);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, allIds.length) }, worker));

  return {
    source: base,
    packages: packages.map((p, i) => ({ ...p, ids: [...ids[i]].sort() })),
    vulns,
  };
}

async function main() {
  const [listPath, outPath] = process.argv.slice(2);
  if (!listPath || !outPath) {
    console.error('Usage: node osv-query.mjs <dependency-list.txt> <out.json>');
    process.exitCode = 2;
    return;
  }
  try {
    const packages = osvPackages(parseMavenDependencyList(readFileSync(listPath, 'utf8')));
    const result = await queryOsv(packages, { base: process.env.OSV_API_BASE || DEFAULT_BASE });
    writeFileSync(outPath, `${JSON.stringify({ ...result, queriedAt: new Date().toISOString() }, null, 2)}\n`);
    const affected = result.packages.filter((p) => p.ids.length).length;
    console.log(`OSV: ${packages.length} packages looked up, ${affected} with advisories, ${Object.keys(result.vulns).length} distinct advisories.`);
  } catch (error) {
    writeFileSync(outPath, `${JSON.stringify({ error: describe(error) }, null, 2)}\n`);
    console.error(`OSV lookup failed: ${describe(error)}`);
    // Never process.exit() after a fetch: on Windows it can trip a libuv assertion while a
    // keep-alive socket closes (content-seed/errors.mjs has the measurements). Set the code instead.
    process.exitCode = 1;
  }
}

if (isMain(import.meta.url)) await main();

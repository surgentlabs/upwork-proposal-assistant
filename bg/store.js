// Jobs store: { [jobId]: record } in chrome.storage.local. Writes are serialised through a
// promise chain so a draft finishing while you change a status can't overwrite either change.
import { JOBS_CAP, OUTCOME_STATUSES } from '../shared/constants.js';

let chain = Promise.resolve();

export function getJobs() {
  return new Promise(r => chrome.storage.local.get('jobs', d => r(d.jobs && typeof d.jobs === 'object' ? d.jobs : {})));
}

export async function getJob(id) { return id ? (await getJobs())[id] || null : null; }

// mutate(record|null) → record to store (or null to delete). Returns the stored record.
export function updateJob(id, mutate) {
  const run = chain.then(async () => {
    const jobs = await getJobs();
    const next = await mutate(jobs[id] ? structuredClone(jobs[id]) : null);
    if (next) { next.updatedAt = Date.now(); jobs[id] = next; } else delete jobs[id];
    prune(jobs);
    await new Promise(r => chrome.storage.local.set({ jobs }, r));
    return next;
  });
  chain = run.catch(() => {});
  return run;
}

export function prune(jobs, cap = JOBS_CAP) {
  const ids = Object.keys(jobs);
  if (ids.length <= cap) return jobs;
  // Jobs you labelled with an outcome are training data for v0.4 — drop unlabelled ones first.
  const labelled = j => (OUTCOME_STATUSES.includes(j.status) ? 1 : 0);
  ids.sort((a, b) => labelled(jobs[a]) - labelled(jobs[b]) || (jobs[a].updatedAt || 0) - (jobs[b].updatedAt || 0));
  for (const id of ids.slice(0, ids.length - cap)) delete jobs[id];
  return jobs;
}

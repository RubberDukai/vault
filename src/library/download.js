'use strict';
/**
 * Resumable pack downloads.
 *
 * These files are tens of gigabytes and the connection you are downloading them
 * over may not be a good one, so: HTTP range resume, write to a .part file, and
 * only move it into the library once the byte count checks out. An interrupted
 * download costs you nothing but the time already spent.
 */

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { pipeline } = require('node:stream/promises');

const jobs = new Map();

const USER_AGENT = 'Vault/0.1 (offline knowledge vault)';

/**
 * Open a streaming GET, following redirects. Plain node:https rather than
 * fetch: fetch's web-stream body pays per-chunk overhead that throttled a
 * 50 GB download to a tenth of the line speed. This gets what curl gets.
 */
function openStream(url, headers, signal, hops = 0) {
  return new Promise((resolve, reject) => {
    if (hops > 8) return reject(new Error('Too many redirects'));
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { headers: { 'user-agent': USER_AGENT, ...headers }, signal }, (res) => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status) && res.headers.location) {
        res.resume();
        return resolve(openStream(new URL(res.headers.location, url).href, headers, signal, hops + 1));
      }
      resolve(res);
    });
    req.on('error', reject);
  });
}

function humanBytes(bytes) {
  if (!bytes || bytes < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function jobState(job) {
  const elapsed = (Date.now() - job.startedAt) / 1000;
  const movedThisRun = job.received - job.resumedFrom;
  const rate = elapsed > 1 ? movedThisRun / elapsed : 0;
  const remaining = job.total ? job.total - job.received : 0;
  return {
    id: job.id,
    filename: job.filename,
    status: job.status,
    received: job.received,
    total: job.total,
    receivedHuman: humanBytes(job.received),
    totalHuman: humanBytes(job.total),
    percent: job.total ? Math.round((job.received / job.total) * 1000) / 10 : 0,
    rateHuman: rate ? `${humanBytes(rate)}/s` : null,
    etaSeconds: rate > 0 && remaining > 0 ? Math.round(remaining / rate) : null,
    error: job.error || null,
    startedAt: new Date(job.startedAt).toISOString(),
  };
}

function list() {
  return [...jobs.values()].map(jobState);
}

function get(id) {
  const job = jobs.get(id);
  return job ? jobState(job) : null;
}

function cancel(id) {
  const job = jobs.get(id);
  if (!job || job.status !== 'downloading') return false;
  job.status = 'cancelled';
  job.controller.abort();
  return true;
}

/**
 * Start (or resume) a download. Returns immediately with a job id; poll `get`
 * for progress. The partial file is kept on failure so a retry picks up where
 * it left off.
 */
function start({ url, destDir, filename, id }) {
  const name = filename || url.split('/').pop();
  const jobId = id || name;

  const existing = jobs.get(jobId);
  if (existing && existing.status === 'downloading') return jobState(existing);

  const job = {
    id: jobId,
    url,
    filename: name,
    destDir,
    destPath: path.join(destDir, name),
    partPath: path.join(destDir, `${name}.part`),
    status: 'downloading',
    received: 0,
    resumedFrom: 0,
    total: 0,
    error: null,
    startedAt: Date.now(),
    controller: new AbortController(),
  };
  jobs.set(jobId, job);

  // A promise the queue can wait on. Failure and cancellation both resolve
  // (with the final state) rather than reject, so a caller never has to
  // guard against an unhandled rejection from a job nobody is watching.
  job.done = run(job).then(() => jobState(job)).catch((err) => {
    if (job.status !== 'cancelled') {
      job.status = 'failed';
      job.error = err.message;
    }
    return jobState(job);
  });

  return jobState(job);
}

/** Wait for a job to finish, however it finishes. */
function wait(id) {
  const job = jobs.get(id);
  return job ? job.done : Promise.resolve(null);
}

/** Forget finished jobs so the list does not grow forever. */
function prune() {
  for (const [id, job] of jobs) {
    if (job.status !== 'downloading') jobs.delete(id);
  }
}

async function run(job) {
  await fsp.mkdir(job.destDir, { recursive: true });

  let resumeAt = 0;
  try {
    resumeAt = (await fsp.stat(job.partPath)).size;
  } catch {
    resumeAt = 0;
  }
  job.received = resumeAt;
  job.resumedFrom = resumeAt;

  const headers = {};
  if (resumeAt > 0) headers.range = `bytes=${resumeAt}-`;

  const res = await openStream(job.url, headers, job.controller.signal);
  const status = res.statusCode || 0;

  if (resumeAt > 0 && status === 200) {
    // Server ignored our range request; start over rather than corrupt the file.
    job.received = 0;
    job.resumedFrom = 0;
    resumeAt = 0;
  } else if (status === 416 && resumeAt > 0) {
    // "Range not satisfiable": the partial file is already the whole file.
    // Confirm against the server's idea of the size, then just finish.
    res.resume();
    const total = Number((res.headers['content-range'] || '').split('/')[1] || 0);
    if (total && resumeAt >= total) {
      job.total = total;
      await fsp.rename(job.partPath, job.destPath);
      job.status = 'complete';
      return;
    }
    throw new Error('Download failed: HTTP 416 (partial file larger than the server\'s copy — delete the .part and retry)');
  } else if (status !== 200 && status !== 206) {
    res.resume();
    throw new Error(`Download failed: HTTP ${status}`);
  }

  const contentLength = Number(res.headers['content-length'] || 0);
  job.total = resumeAt > 0 && status === 206 ? resumeAt + contentLength : contentLength;

  const out = fs.createWriteStream(job.partPath, { flags: resumeAt > 0 ? 'a' : 'w', highWaterMark: 1 << 20 });
  res.on('data', (chunk) => { job.received += chunk.length; });

  await pipeline(res, out);

  if (job.total && job.received !== job.total) {
    throw new Error(`Incomplete download: got ${job.received} of ${job.total} bytes`);
  }

  await fsp.rename(job.partPath, job.destPath);
  job.status = 'complete';
}

module.exports = { start, get, list, cancel, wait, prune, humanBytes };

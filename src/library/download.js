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
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const jobs = new Map();

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

  run(job).catch((err) => {
    if (job.status !== 'cancelled') {
      job.status = 'failed';
      job.error = err.message;
    }
  });

  return jobState(job);
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

  const headers = { 'user-agent': 'Vault/0.1 (offline knowledge vault)' };
  if (resumeAt > 0) headers.range = `bytes=${resumeAt}-`;

  const res = await fetch(job.url, { headers, signal: job.controller.signal, redirect: 'follow' });

  if (resumeAt > 0 && res.status === 200) {
    // Server ignored our range request; start over rather than corrupt the file.
    job.received = 0;
    job.resumedFrom = 0;
    resumeAt = 0;
  } else if (!res.ok && res.status !== 206) {
    throw new Error(`Download failed: HTTP ${res.status}`);
  }

  const contentLength = Number(res.headers.get('content-length') || 0);
  job.total = resumeAt > 0 && res.status === 206 ? resumeAt + contentLength : contentLength;

  const out = fs.createWriteStream(job.partPath, { flags: resumeAt > 0 ? 'a' : 'w' });
  const body = Readable.fromWeb(res.body);
  body.on('data', (chunk) => { job.received += chunk.length; });

  await pipeline(body, out);

  if (job.total && job.received !== job.total) {
    throw new Error(`Incomplete download: got ${job.received} of ${job.total} bytes`);
  }

  await fsp.rename(job.partPath, job.destPath);
  job.status = 'complete';
}

module.exports = { start, get, list, cancel, humanBytes };

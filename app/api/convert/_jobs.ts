import crypto from 'crypto';

export type JobStatus = 'queued' | 'processing' | 'done' | 'error';

export type ConvertJob = {
  id: string;
  status: JobStatus;
  progress: number;
  message: string;
  filename: string;
  createdAt: number;
  updatedAt: number;
  result?: Buffer;
  error?: string;
};

const JOB_TTL_MS = 30 * 60 * 1000; // 30 min

const globalForJobs = globalThis as unknown as { __pdfToExcelJobs?: Map<string, ConvertJob> };

export const jobs: Map<string, ConvertJob> = globalForJobs.__pdfToExcelJobs ?? new Map();
if (!globalForJobs.__pdfToExcelJobs) {
  globalForJobs.__pdfToExcelJobs = jobs;
}

let cleanupStarted = false;

export function ensureCleanupLoop() {
  if (cleanupStarted) return;
  cleanupStarted = true;

  setInterval(() => {
    const now = Date.now();
    for (const [id, job] of jobs.entries()) {
      if (now - job.updatedAt > JOB_TTL_MS) {
        jobs.delete(id);
      }
    }
  }, 60_000).unref?.();
}

export function createJob(filename: string): ConvertJob {
  ensureCleanupLoop();

  const id = crypto.randomUUID();
  const now = Date.now();
  const job: ConvertJob = {
    id,
    status: 'queued',
    progress: 0,
    message: 'Aguardando...',
    filename,
    createdAt: now,
    updatedAt: now,
  };

  jobs.set(id, job);
  return job;
}

export function updateJob(id: string, patch: Partial<ConvertJob>) {
  const job = jobs.get(id);
  if (!job) return;

  Object.assign(job, patch, { updatedAt: Date.now() });
  jobs.set(id, job);
}

export function getJob(id: string) {
  return jobs.get(id);
}

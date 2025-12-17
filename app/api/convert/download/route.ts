import { getJob } from '../_jobs';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return new Response(JSON.stringify({ error: 'jobId é obrigatório' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const job = getJob(jobId);
  if (!job) {
    return new Response(JSON.stringify({ error: 'Job não encontrado (expirado ou inválido)' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (job.status === 'error') {
    return new Response(JSON.stringify({ error: job.error || 'Falha ao processar' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (job.status !== 'done' || !job.result) {
    return new Response(JSON.stringify({ error: 'Arquivo ainda não está pronto' }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const filename = job.filename.toLowerCase().endsWith('.pdf')
    ? job.filename.replace(/\.pdf$/i, '.xlsx')
    : `${job.filename}.xlsx`;

  const body = job.result.buffer.slice(
    job.result.byteOffset,
    job.result.byteOffset + job.result.byteLength
  ) as ArrayBuffer;

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

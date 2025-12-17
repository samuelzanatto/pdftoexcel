import { getJob } from '../_jobs';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return new Response('jobId é obrigatório', { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastSnapshot = '';
      let interval: ReturnType<typeof setInterval> | null = null;

      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      const tick = () => {
        const job = getJob(jobId);
        if (!job) {
          send('error', { error: 'Job não encontrado (expirado ou inválido)' });
          cleanup();
          controller.close();
          return;
        }

        const payload = {
          status: job.status,
          progress: job.progress,
          message: job.message,
          error: job.error ?? null,
        };

        const snapshot = JSON.stringify(payload);
        if (snapshot !== lastSnapshot) {
          lastSnapshot = snapshot;
          send('progress', payload);
        }

        if (job.status === 'done' || job.status === 'error') {
          cleanup();
          controller.close();
        }
      };

      const cleanup = () => {
        if (interval) {
          clearInterval(interval);
          interval = null;
        }
      };

      // Primeiro evento imediato
      tick();
      interval = setInterval(tick, 500);

      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}

import { createJob, updateJob } from '../_jobs';
import { convertPdfToExcel } from '../_converter';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: 'Nenhum arquivo enviado' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!file.type.includes('pdf')) {
      return new Response(JSON.stringify({ error: 'O arquivo deve ser um PDF' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (!process.env.GROQ_API_KEY) {
      return new Response(JSON.stringify({ error: 'GROQ_API_KEY não configurada' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const job = createJob(file.name || 'arquivo.pdf');

    // Disparar processamento assíncrono
    (async () => {
      try {
        updateJob(job.id, { status: 'processing', progress: 1, message: 'Iniciando...' });

        const arrayBuffer = await file.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        const { excelBuffer } = await convertPdfToExcel(buffer, (progress, message) => {
          updateJob(job.id, { status: 'processing', progress, message });
        });

        updateJob(job.id, { status: 'done', progress: 100, message: 'Concluído', result: excelBuffer });
      } catch (err) {
        updateJob(job.id, {
          status: 'error',
          progress: 100,
          message: 'Falha',
          error: err instanceof Error ? err.message : 'Erro desconhecido',
        });
      }
    })();

    return new Response(JSON.stringify({ jobId: job.id }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: `Erro ao iniciar o processamento: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

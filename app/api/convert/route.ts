// Forçar runtime Node.js (para libs nativas funcionarem)
export const runtime = 'nodejs';

export async function POST() {
  // Endpoint antigo desativado: use o fluxo novo com progresso.
  return new Response(
    JSON.stringify({
      error:
        'Endpoint /api/convert desativado. Use /api/convert/start + /api/convert/progress + /api/convert/download.',
    }),
    {
      status: 410,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

import { pdf } from 'pdf-to-img';
import ExcelJS from 'exceljs';
import Groq from 'groq-sdk';

// Forçar runtime Node.js (para workers funcionarem)
export const runtime = 'nodejs';

// Inicializar cliente Groq
const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

type TableMatrix = string[][];

// Função para extrair tabela da imagem usando Groq Vision
async function extractTableFromImageWithVision(imageBase64: string, pageNum: number, isFirstPage: boolean): Promise<TableMatrix | null> {
  try {
    const completion = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `Analise esta imagem de uma página de PDF e extraia a tabela.

INSTRUÇÕES:
1. Identifique a tabela na imagem
2. Extraia TODAS as linhas e colunas da tabela
3. ${isFirstPage ? 'Inclua a linha de cabeçalho' : 'NÃO inclua cabeçalhos (já foram extraídos)'}
4. Cada linha da tabela = uma linha no resultado
5. Separe corretamente cada coluna
6. Preserve todos os valores (números, textos, moedas, datas)
7. Retorne JSON: {"table": [["col1","col2"],["val1","val2"]]}
8. Se não houver tabela visível, retorne: {"table": []}

IMPORTANTE: Extraia os dados EXATAMENTE como aparecem na imagem.`,
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/png;base64,${imageBase64}`,
              },
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 8000,
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) return null;

    // Tentar extrair JSON da resposta
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log(`Página ${pageNum}: resposta não contém JSON válido`);
      return null;
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    if (parsed.table && Array.isArray(parsed.table) && parsed.table.length > 0) {
      return parsed.table;
    }
    if (parsed.tables && Array.isArray(parsed.tables) && parsed.tables.length > 0) {
      return parsed.tables[0];
    }
    
    return null;
  } catch (error) {
    console.error(`Erro na API Groq Vision (página ${pageNum}):`, error);
    return null;
  }
}

export async function POST(request: Request) {
  try {
    // 1. Receber o arquivo PDF do FormData
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return new Response(JSON.stringify({ error: 'Nenhum arquivo enviado' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verificar se é um PDF
    if (!file.type.includes('pdf')) {
      return new Response(JSON.stringify({ error: 'O arquivo deve ser um PDF' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Verificar se a API key está configurada
    if (!process.env.GROQ_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'GROQ_API_KEY não configurada. Adicione no arquivo .env.local' }),
        {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 2. Converter File para Buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 3. Converter PDF para imagens e processar com Vision AI
    console.log('Convertendo PDF para imagens...');
    const document = await pdf(buffer, { scale: 2 }); // scale 2 para melhor qualidade
    
    const allRows: string[][] = [];
    let pageNum = 0;
    let foundTable = false;

    for await (const image of document) {
      pageNum++;
      console.log(`Processando página ${pageNum} com Vision AI...`);
      
      // Converter imagem para base64
      const imageBase64 = image.toString('base64');
      
      // Extrair tabela usando Vision AI
      const isFirstPage = allRows.length === 0;
      const result = await extractTableFromImageWithVision(imageBase64, pageNum, isFirstPage);
      
      if (result && result.length > 0) {
        foundTable = true;
        
        for (const row of result) {
          if (!Array.isArray(row)) continue;
          
          // Pular linhas vazias
          if (row.every(cell => !cell || String(cell).trim() === '')) continue;
          
          // Pular cabeçalhos repetidos (após a primeira página)
          if (allRows.length > 0) {
            const firstRowStr = allRows[0].join('|').toLowerCase();
            const currentRowStr = row.map(c => String(c || '')).join('|').toLowerCase();
            if (firstRowStr === currentRowStr) continue;
          }
          
          allRows.push(row.map(cell => String(cell || '').trim()));
        }
        
        console.log(`Página ${pageNum}: ${result.length} linhas extraídas (total: ${allRows.length})`);
      } else {
        console.log(`Página ${pageNum}: nenhuma tabela encontrada`);
      }
    }

    if (!foundTable || allRows.length === 0) {
      return new Response(
        JSON.stringify({ 
          error: 'Nenhuma tabela encontrada no PDF. A IA não conseguiu identificar tabelas nas imagens.' 
        }),
        {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Total de linhas extraídas: ${allRows.length}`);

    // 4. Criar workbook Excel com ExcelJS
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PDF to Excel Converter';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Tabela');
    formatWorksheet(worksheet, allRows);

    // 5. Gerar arquivo Excel
    const excelBuffer = await workbook.xlsx.writeBuffer();

    // 6. Retornar o arquivo Excel
    return new Response(excelBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="tabela_extraida.xlsx"',
      },
    });
  } catch (error) {
    console.error('Erro ao processar PDF:', error);
    return new Response(
      JSON.stringify({ 
        error: `Erro ao processar o arquivo: ${error instanceof Error ? error.message : 'Erro desconhecido'}` 
      }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}

// Função auxiliar para formatar a planilha
function formatWorksheet(worksheet: ExcelJS.Worksheet, tableData: string[][]) {
  // Adicionar dados
  tableData.forEach((row) => {
    worksheet.addRow(row);
  });

  // Formatar cabeçalho (primeira linha)
  if (tableData.length > 0) {
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' }, // Azul
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  // Ajustar largura das colunas automaticamente
  worksheet.columns.forEach((column) => {
    let maxLength = 10;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const cellValue = cell.value?.toString() || '';
      maxLength = Math.max(maxLength, cellValue.length + 2);
    });
    column.width = Math.min(maxLength, 50); // Máximo de 50 caracteres
  });

  // Adicionar bordas a todas as células
  worksheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } },
      };
    });
  });

  // Congelar primeira linha (cabeçalho)
  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
}

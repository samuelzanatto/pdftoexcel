import { pdf } from 'pdf-to-img';
import ExcelJS from 'exceljs';
import Groq from 'groq-sdk';

export type ProgressCallback = (progress: number, message: string) => void;

type TableMatrix = string[][];

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

async function extractTableFromImageWithVision(
  imageBase64: string,
  pageNum: number,
  isFirstPage: boolean
): Promise<TableMatrix | null> {
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
7. Não insira quebras de linha dentro das células. Retorne o texto contínuo (uma única string por célula). A quebra visual será aplicada pela largura das colunas no Excel.
8. Retorne JSON: {"table": [["col1","col2"],["val1","val2"]]}
9. Se não houver tabela visível, retorne: {"table": []}

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

function formatWorksheet(worksheet: ExcelJS.Worksheet, tableData: string[][]) {
  tableData.forEach((row) => {
    worksheet.addRow(row);
  });

  if (tableData.length > 0) {
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF4472C4' },
    };
    headerRow.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  }

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (rowNumber === 1) {
        cell.alignment = { ...cell.alignment, wrapText: true, vertical: 'middle' };
        return;
      }

      cell.alignment = {
        ...cell.alignment,
        wrapText: true,
        vertical: 'top',
        horizontal: 'left',
      };
    });
  });

  worksheet.columns.forEach((column) => {
    let maxLength = 10;
    column.eachCell?.({ includeEmpty: true }, (cell) => {
      const cellValue = cell.value?.toString() || '';
      maxLength = Math.max(maxLength, cellValue.length + 2);
    });

    // Colunas um pouco mais largas para quebrar menos por largura
    column.width = Math.min(maxLength, 45);
  });

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

  worksheet.views = [{ state: 'frozen', ySplit: 1 }];
}

export async function convertPdfToExcel(
  buffer: Buffer,
  onProgress?: ProgressCallback
): Promise<{ excelBuffer: Buffer; rowCount: number; pageCount: number | null }> {
  const report = (progress: number, message: string) => {
    onProgress?.(Math.max(0, Math.min(100, Math.round(progress))), message);
  };

  report(5, 'Convertendo PDF para imagens...');

  const document = await pdf(buffer, { scale: 2 });
  const totalPages: number | null =
    typeof (document as unknown as { length?: unknown }).length === 'number'
      ? ((document as unknown as { length: number }).length ?? null)
      : null;

  const allRows: string[][] = [];
  let pageNum = 0;
  let foundTable = false;

  for await (const image of document) {
    pageNum++;

    const baseProgress = 10;
    const progressSpan = 75;
    const pageProgress = totalPages ? (pageNum / totalPages) * progressSpan : Math.min(pageNum * 6, progressSpan);
    report(baseProgress + pageProgress, `Processando página ${pageNum}${totalPages ? ` de ${totalPages}` : ''}...`);

    const imageBase64 = image.toString('base64');

    const isFirstPage = allRows.length === 0;
    const result = await extractTableFromImageWithVision(imageBase64, pageNum, isFirstPage);

    if (result && result.length > 0) {
      foundTable = true;

      for (const row of result) {
        if (!Array.isArray(row)) continue;

        if (row.every((cell) => !cell || String(cell).trim() === '')) continue;

        if (allRows.length > 0) {
          const firstRowStr = allRows[0].join('|').toLowerCase();
          const currentRowStr = row.map((c) => String(c || '')).join('|').toLowerCase();
          if (firstRowStr === currentRowStr) continue;
        }

        allRows.push(
          row
            .map((cell) =>
              String(cell || '')
                .replace(/\r?\n+/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
            )
        );
      }

      console.log(`Página ${pageNum}: ${result.length} linhas extraídas (total: ${allRows.length})`);
    } else {
      console.log(`Página ${pageNum}: nenhuma tabela encontrada`);
    }
  }

  if (!foundTable || allRows.length === 0) {
    report(100, 'Nenhuma tabela encontrada');
    throw new Error(
      'Nenhuma tabela encontrada no PDF. A IA não conseguiu identificar tabelas nas imagens.'
    );
  }

  report(90, 'Gerando planilha Excel...');
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'PDF to Excel Converter';
  workbook.created = new Date();

  const worksheet = workbook.addWorksheet('Tabela');
  formatWorksheet(worksheet, allRows);

  const excelArrayBuffer = await workbook.xlsx.writeBuffer();
  const excelBuffer = Buffer.from(excelArrayBuffer);

  report(100, 'Concluído');
  return { excelBuffer, rowCount: allRows.length, pageCount: totalPages ?? (pageNum || null) };
}

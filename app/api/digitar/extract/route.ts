import { NextResponse } from 'next/server';
import { createWorker } from 'tesseract.js';
import type { Word } from 'tesseract.js';
import { pdf } from 'pdf-to-img';
import { getCurrentUser, hasRole } from '@/lib/auth';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_PDF_SIZE_BYTES = 20 * 1024 * 1024;
// Cada pagina roda OCR por completo -- sem teto, um PDF de centenas de
// paginas travaria a requisicao por minutos (e o HAProxy corta por
// inatividade bem antes disso, ver CLAUDE.md deste diretorio).
const MAX_PDF_PAGES = 30;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const PDF_TYPE = 'application/pdf';

const OCR_PROMPT = [
  'You are an expert OCR engine for Portuguese documents.',
  'Extract all visible text with maximum accuracy.',
  'Preserve structure and formatting as closely as possible:',
  '- Keep headings, paragraphs, lists, table-like blocks, and line breaks.',
  '- Preserve numeric values, punctuation, dates, currency, and identifiers exactly.',
  '- Do not summarize and do not translate.',
  '- If uncertain, keep the most likely reading and preserve original spacing intent.',
  '',
  'Return only the final transcribed content in Markdown.',
].join('\n');

function toDataUrl(buffer: ArrayBuffer, mimeType: string): string {
  const base64 = Buffer.from(buffer).toString('base64');
  return `data:${mimeType};base64,${base64}`;
}

// Buffer do Node e' uma VIEW sobre um ArrayBuffer que pode ser maior que o
// proprio buffer (pool compartilhado) -- pegar so `.buffer` sem recortar
// por byteOffset/byteLength vazaria bytes vizinhos de outro buffer junto.
function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// pdf-to-img aceita data URL direto -- evita escrever arquivo temporario
// (sem isso teria que gerenciar nome unico + limpeza entre requests
// concorrentes). Cada pagina vira um Buffer PNG.
async function pdfToPageBuffers(buffer: ArrayBuffer): Promise<ArrayBuffer[]> {
  const dataUrl = toDataUrl(buffer, PDF_TYPE);
  const document = await pdf(dataUrl, { scale: 2 });
  if (document.length > MAX_PDF_PAGES) {
    throw new Error(`PDF com ${document.length} paginas -- maximo ${MAX_PDF_PAGES}.`);
  }
  const pages: ArrayBuffer[] = [];
  for await (const image of document) pages.push(toArrayBuffer(image));
  return pages;
}

// Reconstruct reading order from bounding-box data.
// Groups words into rows by Y proximity, sorts each row by X,
// and spaces words proportionally so columns stay aligned.
function reconstructFromWords(words: Word[], imageWidth: number): string {
  const MIN_CONF = 20;
  const filtered = words.filter(w => w.confidence >= MIN_CONF && w.text.trim());
  if (!filtered.length) return '';

  // Estimate average word height for row-clustering tolerance
  const avgH = filtered.reduce((s, w) => s + (w.bbox.y1 - w.bbox.y0), 0) / filtered.length;
  const rowTol = Math.max(avgH * 0.6, 8);

  // Sort by Y then X
  filtered.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);

  // Cluster into rows
  const rows: Word[][] = [];
  for (const word of filtered) {
    const last = rows[rows.length - 1];
    const lastY = last ? last[0].bbox.y0 : -Infinity;
    if (!last || word.bbox.y0 - lastY > rowTol) {
      rows.push([word]);
    } else {
      last.push(word);
    }
  }

  // Render each row: use proportional spaces to hint at column positions
  const charWidth = imageWidth > 0 ? imageWidth / 120 : 8; // ~120 chars wide
  return rows.map(row => {
    row.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    let line = '';
    let cursorX = 0;
    for (const word of row) {
      const targetCol = Math.round(word.bbox.x0 / charWidth);
      const spaces = Math.max(1, targetCol - cursorX);
      if (line.length > 0) line += ' '.repeat(spaces);
      line += word.text;
      cursorX = Math.round(word.bbox.x1 / charWidth);
    }
    return line.trimEnd();
  }).join('\n');
}

async function recognizeOne(worker: Awaited<ReturnType<typeof createWorker>>, buffer: ArrayBuffer): Promise<string> {
  const buf = Buffer.from(buffer);
  const { data } = await worker.recognize(buf);
  const imageWidth = data.blocks?.[0]?.bbox?.x1 ?? 0;

  // Extract words from nested blocks→paragraphs→lines→words
  const words: Word[] = (data.blocks ?? []).flatMap(b =>
    (b.paragraphs ?? []).flatMap(p =>
      (p.lines ?? []).flatMap(l => l.words ?? [])
    )
  );

  const reconstructed = reconstructFromWords(words, imageWidth);
  return reconstructed || data.text.trim();
}

async function runTesseract(buffer: ArrayBuffer): Promise<string> {
  const worker = await createWorker(['por', 'eng']);
  try {
    return await recognizeOne(worker, buffer);
  } finally {
    await worker.terminate();
  }
}

// Um worker so, reaproveitado entre todas as paginas de um PDF -- criar/
// destruir o worker WASM por pagina (chamando runTesseract em loop) seria
// bem mais lento, e o tempo total de processamento importa aqui: o
// HAProxy corta a conexao por inatividade se a resposta demorar demais
// (ver CLAUDE.md deste diretorio).
async function runTesseractBatch(buffers: ArrayBuffer[]): Promise<string[]> {
  const worker = await createWorker(['por', 'eng']);
  try {
    const results: string[] = [];
    for (const buffer of buffers) {
      results.push(await recognizeOne(worker, buffer));
    }
    return results;
  } finally {
    await worker.terminate();
  }
}

async function runOpenAI(apiKey: string, buffer: ArrayBuffer, mimeType: string): Promise<string> {
  const imageDataUrl = toDataUrl(buffer, mimeType);
  const model = process.env.OCR_MODEL || 'gpt-4.1';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: OCR_PROMPT },
            { type: 'input_image', image_url: imageDataUrl, detail: 'high' },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as { output_text?: string };
  return (data.output_text || '').trim();
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Arquivo nao enviado.' }, { status: 400 });
    }

    const isPdf = file.type === PDF_TYPE;
    if (!ACCEPTED_TYPES.has(file.type) && !isPdf) {
      return NextResponse.json(
        { error: 'Formato invalido. Use JPG, PNG, WEBP ou PDF.' },
        { status: 400 }
      );
    }

    const maxSize = isPdf ? MAX_PDF_SIZE_BYTES : MAX_FILE_SIZE_BYTES;
    if (file.size <= 0 || file.size > maxSize) {
      return NextResponse.json(
        { error: `Arquivo fora do limite. Maximo: ${Math.round(maxSize / 1024 / 1024)}MB.` },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const apiKey = process.env.OPENAI_API_KEY;
    const user = await getCurrentUser();
    const requestedEngine = String(form.get('engine') || 'auto');
    const canUseExternal = hasRole(user, 'digitar');
    const useOpenAI = Boolean(apiKey && canUseExternal && requestedEngine === 'openai');

    let markdown: string;
    const engine = useOpenAI ? 'openai' : 'tesseract';

    if (isPdf) {
      let pages: ArrayBuffer[];
      try {
        pages = await pdfToPageBuffers(arrayBuffer);
      } catch (err) {
        return NextResponse.json(
          { error: err instanceof Error ? err.message : 'Falha ao processar o PDF.' },
          { status: 400 }
        );
      }
      if (!pages.length) {
        return NextResponse.json({ error: 'PDF sem paginas.' }, { status: 422 });
      }

      // OpenAI: cada pagina e' uma requisicao HTTP independente, sem
      // recurso local compartilhado -- roda em paralelo, corta o tempo
      // total (importa pro timeout do HAProxy, ver CLAUDE.md). Tesseract:
      // um worker WASM so processa um job por vez mesmo se chamado em
      // paralelo, entao sequencial aqui e' igual de rapido e usa menos
      // memoria (nao levanta N workers ao mesmo tempo).
      const pageTexts = useOpenAI
        ? await Promise.all(pages.map((p) => runOpenAI(apiKey as string, p, 'image/png')))
        : await runTesseractBatch(pages);

      markdown = pageTexts
        .map((text, i) => (pages.length > 1 ? `## Página ${i + 1}\n\n${text}` : text))
        .join('\n\n---\n\n');
    } else if (useOpenAI) {
      markdown = await runOpenAI(apiKey as string, arrayBuffer, file.type);
    } else {
      markdown = await runTesseract(arrayBuffer);
    }

    if (!markdown) {
      return NextResponse.json({ error: 'Nao foi possivel extrair texto.' }, { status: 422 });
    }

    return NextResponse.json({ markdown, engine });
  } catch (error) {
    console.error('Erro no OCR:', error);
    return NextResponse.json({ error: 'Erro interno do servidor.' }, { status: 500 });
  }
}

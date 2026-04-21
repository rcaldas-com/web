import { NextResponse } from 'next/server';
import { createWorker } from 'tesseract.js';
import type { Word } from 'tesseract.js';

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

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

async function runTesseract(buffer: ArrayBuffer): Promise<string> {
  const worker = await createWorker(['por', 'eng']);
  try {
    const buf = Buffer.from(buffer);
    const { data } = await worker.recognize(buf);
    const imageWidth = data.blocks?.[0]?.bbox?.x1 ?? 0;
    const reconstructed = reconstructFromWords(data.words, imageWidth);
    return reconstructed || data.text.trim();
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

    if (!ACCEPTED_TYPES.has(file.type)) {
      return NextResponse.json(
        { error: 'Formato invalido. Use JPG, PNG ou WEBP.' },
        { status: 400 }
      );
    }

    if (file.size <= 0 || file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json(
        { error: 'Arquivo fora do limite. Maximo: 10MB.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const apiKey = process.env.OPENAI_API_KEY;

    let markdown: string;
    let engine: string;

    if (apiKey) {
      markdown = await runOpenAI(apiKey, arrayBuffer, file.type);
      engine = 'openai';
    } else {
      markdown = await runTesseract(arrayBuffer);
      engine = 'tesseract';
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

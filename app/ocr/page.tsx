'use client';

import { DragEvent, useCallback, useEffect, useRef, useState } from 'react';

type Status = 'idle' | 'loading' | 'success' | 'error';

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp']);

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getImageFromClipboard(e: ClipboardEvent): File | null {
  for (const item of Array.from(e.clipboardData?.items ?? [])) {
    if (item.kind === 'file' && ACCEPTED.has(item.type)) {
      const f = item.getAsFile();
      if (f) return f;
    }
  }
  return null;
}

export default function OcrPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [text, setText] = useState('');
  const [engine, setEngine] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadFile = useCallback((f: File) => {
    if (!ACCEPTED.has(f.type)) {
      setError('Formato invalido. Use JPG, PNG ou WEBP.');
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setError('Arquivo muito grande. Maximo 10MB.');
      return;
    }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
    setError('');
    setText('');
    setStatus('idle');
  }, []);

  // Global paste listener
  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      const f = getImageFromClipboard(e);
      if (f) loadFile(f);
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, [loadFile]);

  // Revoke old object URL on change
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = Array.from(e.dataTransfer.files).find(f => ACCEPTED.has(f.type));
    if (f) loadFile(f);
  };

  const onProcess = async () => {
    if (!file) return;
    setStatus('loading');
    setError('');
    setText('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/ocr/extract', { method: 'POST', body: formData });
      const json = (await response.json()) as { markdown?: string; error?: string; engine?: string };
      if (!response.ok || !json.markdown) {
        setError(json.error || 'Falha ao extrair texto.');
        setStatus('error');
        return;
      }
      setText(json.markdown);
      setEngine(json.engine || '');
      setStatus('success');
    } catch {
      setError('Erro de rede ao processar OCR.');
      setStatus('error');
    }
  };

  const onCopy = async () => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onClear = () => {
    setFile(null);
    setPreviewUrl('');
    setText('');
    setEngine('');
    setError('');
    setStatus('idle');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-10 space-y-6">
      <div className="space-y-1">
        <h1 className="text-3xl font-bold text-zinc-900">OCR de Documentos</h1>
        <p className="text-zinc-500 text-sm">
          Selecione um arquivo, arraste ou <kbd className="rounded border border-zinc-300 bg-zinc-100 px-1 py-0.5 text-xs font-mono">Ctrl+V</kbd> para colar da area de transferencia.
        </p>
      </div>

      {/* Drop zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative cursor-pointer rounded-xl border-2 border-dashed transition-colors
          ${dragging ? 'border-zinc-500 bg-zinc-100' : 'border-zinc-300 bg-zinc-50 hover:bg-zinc-100'}
          ${file ? 'min-h-[320px]' : 'min-h-[200px]'}
          flex flex-col items-center justify-center gap-3`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) loadFile(f); }}
        />
        {previewUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="Preview"
            onClick={e => e.stopPropagation()}
            className="max-h-[60vh] max-w-full rounded-lg border border-zinc-200 object-contain shadow-sm"
          />
        ) : (
          <>
            <span className="text-4xl">🧾</span>
            <p className="text-zinc-500 text-sm text-center px-4">
              Clique para selecionar, arraste uma imagem ou pressione <strong>Ctrl+V</strong>
            </p>
            <p className="text-xs text-zinc-400">JPG · PNG · WEBP · max 10MB</p>
          </>
        )}
      </div>

      {/* File info + action row */}
      {file && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-zinc-600">
            <strong>{file.name}</strong> — {formatBytes(file.size)}
          </span>
          <button
            type="button"
            onClick={onProcess}
            disabled={status === 'loading'}
            className="rounded-lg bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-700 disabled:opacity-60 transition-colors"
          >
            {status === 'loading' ? '⏳ Processando...' : '✦ Extrair texto'}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-lg border border-zinc-300 px-4 py-2.5 text-sm text-zinc-600 hover:bg-zinc-50 transition-colors"
          >
            Limpar
          </button>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {/* Result */}
      {(status === 'success' || text) && (
        <section className="rounded-xl border bg-white p-5 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-semibold text-zinc-900">Texto extraido (Markdown)</h2>
              {engine && (
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  engine === 'openai' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-500'
                }`}>
                  {engine === 'openai' ? 'GPT-4.1 Vision' : 'Tesseract'}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={onCopy}
              className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm text-zinc-700 hover:bg-zinc-50 transition-colors"
            >
              {copied ? '✓ Copiado!' : 'Copiar'}
            </button>
          </div>
          <textarea
            value={text}
            readOnly
            className="h-[420px] w-full rounded-lg border border-zinc-200 bg-zinc-50 p-3 font-mono text-sm leading-6 text-zinc-800 outline-none"
          />
        </section>
      )}
    </main>
  );
}

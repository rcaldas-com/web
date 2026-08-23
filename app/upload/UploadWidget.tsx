'use client';

import { DragEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import CopyLinkButton from '@/components/CopyLinkButton';

type Status = 'idle' | 'uploading' | 'success' | 'error';

const MAX_BYTES = 500 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const min = Math.floor(seconds / 60);
  const sec = Math.round(seconds % 60);
  return `${min}min ${String(sec).padStart(2, '0')}s`;
}

export default function UploadWidget({ domains, defaultDomain }: { domains: string[]; defaultDomain: string }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [domain, setDomain] = useState(defaultDomain);
  const [slug, setSlug] = useState('');
  const [dragging, setDragging] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [resultUrl, setResultUrl] = useState('');
  // loaded/total/speed num objeto só: os três mudam juntos, a cada evento de
  // progresso, e separá-los renderizaria três vezes por evento.
  const [progress, setProgress] = useState({ loaded: 0, total: 0, bytesPerSec: 0 });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const startedAtRef = useRef(0);

  const loadFile = (f: File) => {
    if (f.size > MAX_BYTES) {
      setError('Arquivo acima do limite de 500MB.');
      return;
    }
    setFile(f);
    setError('');
    setResultUrl('');
    setStatus('idle');
  };

  useEffect(() => {
    const handler = (e: ClipboardEvent) => {
      for (const item of Array.from(e.clipboardData?.items ?? [])) {
        if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) loadFile(f);
          break;
        }
      }
    };
    window.addEventListener('paste', handler);
    return () => window.removeEventListener('paste', handler);
  }, []);

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files[0];
    if (f) loadFile(f);
  };

  // XMLHttpRequest e nao fetch: fetch simplesmente nao expoe progresso de
  // UPLOAD -- nao existe evento pra bytes enviados, so' pra recebidos. Num
  // arquivo de 500MB isso e' a diferenca entre uma barra e vários minutos de
  // "enviando..." sem sinal nenhum de vida.
  const onUpload = () => {
    if (!file || !domain) return;
    setStatus('uploading');
    setError('');
    setProgress({ loaded: 0, total: file.size, bytesPerSec: 0 });
    startedAtRef.current = Date.now();

    const formData = new FormData();
    formData.append('file', file);
    formData.append('domain', domain);
    if (slug.trim()) formData.append('slug', slug.trim());

    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    xhr.open('POST', '/api/upload');

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const elapsed = (Date.now() - startedAtRef.current) / 1000;
      setProgress({
        loaded: e.loaded,
        total: e.total,
        // Media desde o inicio, nao taxa instantanea: a instantanea oscila
        // tanto que o tempo restante fica pulando e deixa de informar.
        bytesPerSec: elapsed > 0 ? e.loaded / elapsed : 0,
      });
    };

    xhr.onload = () => {
      xhrRef.current = null;
      let json: { url?: string; error?: string } = {};
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        // resposta nao-JSON (ex: pagina de erro de proxy) cai no if abaixo
      }
      if (xhr.status < 200 || xhr.status >= 300 || !json.url) {
        setError(json.error || `Falha ao enviar o arquivo (HTTP ${xhr.status}).`);
        setStatus('error');
        return;
      }
      setResultUrl(json.url);
      setStatus('success');
      router.refresh(); // pra "meus links" (renderizado no server) pegar o novo link
    };

    xhr.onerror = () => {
      xhrRef.current = null;
      setError('Erro de rede ao enviar.');
      setStatus('error');
    };

    xhr.onabort = () => {
      xhrRef.current = null;
      setStatus('idle');
      setProgress({ loaded: 0, total: 0, bytesPerSec: 0 });
    };

    xhr.send(formData);
  };

  const onCancel = () => xhrRef.current?.abort();

  // Sair da pagina no meio do envio deixaria a requisicao pendurada; abortar
  // no unmount tambem evita setState em componente desmontado.
  useEffect(() => () => xhrRef.current?.abort(), []);

  const onClear = () => {
    xhrRef.current?.abort();
    setFile(null);
    setSlug('');
    setResultUrl('');
    setError('');
    setStatus('idle');
    setProgress({ loaded: 0, total: 0, bytesPerSec: 0 });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.loaded / progress.total) * 100)) : 0;

  if (!domains.length) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
        Nenhum domínio com links curtos habilitado ainda. Configure em{' '}
        <Link href="/configuracoes/dominios" className="underline">
          Configurações → Domínios
        </Link>
        .
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed transition-colors ${
          dragging
            ? 'border-zinc-500 bg-zinc-100 dark:border-blue-400 dark:bg-blue-500/10'
            : 'border-zinc-300 bg-zinc-50 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:hover:bg-zinc-700/70'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) loadFile(f);
          }}
        />
        <span className="text-4xl">📎</span>
        <p className="px-4 text-center text-sm text-zinc-500 dark:text-zinc-300">
          Clique para selecionar, arraste um arquivo ou pressione <strong>Ctrl+V</strong>
        </p>
        <p className="text-xs text-zinc-400 dark:text-zinc-500">Máximo 500MB</p>
      </div>

      {file && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="text-zinc-600 dark:text-zinc-300">
            <strong>{file.name}</strong> — {formatBytes(file.size)}
          </span>

          <label className="flex items-center gap-1.5">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">link:</span>
            <span className="text-xs text-zinc-400 dark:text-zinc-500">{domain}/</span>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="aleatório"
              title="Opcional. Letras, números, - e _. Texto inválido é sanitizado; se já estiver em uso, ganha um sufixo."
              className="w-32 rounded border border-zinc-200 bg-white px-2 py-1 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
            />
          </label>

          {domains.length > 1 && (
            <select
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            >
              {domains.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={onUpload}
            disabled={status === 'uploading'}
            className="rounded-full bg-zinc-900 px-3 py-1.5 text-xs text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-70 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {status === 'uploading' ? 'enviando...' : 'enviar e gerar link'}
          </button>
          <button
            type="button"
            onClick={status === 'uploading' ? onCancel : onClear}
            className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
          >
            {status === 'uploading' ? 'cancelar' : 'limpar'}
          </button>
        </div>
      )}

      {status === 'uploading' && progress.total > 0 && (
        <div className="space-y-1.5">
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
          >
            <div
              className="h-full rounded-full bg-zinc-900 transition-[width] duration-150 ease-linear dark:bg-zinc-100"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500 dark:text-zinc-400">
            <span>
              {pct}% — {formatBytes(progress.loaded)} de {formatBytes(progress.total)}
            </span>
            <span>
              {/* Os bytes terem saido daqui nao quer dizer que o servidor
                  terminou: o evento de progresso conta o que foi entregue ao
                  socket, e ainda falta o proxy repassar e o servidor gravar.
                  Sem esta troca de rotulo, a barra "trava" em 100% e parece
                  defeito justamente no fim do envio de um arquivo grande. */}
              {progress.loaded >= progress.total
                ? 'processando no servidor...'
                : `${formatBytes(progress.bytesPerSec)}/s · falta ${formatDuration(
                    (progress.total - progress.loaded) / progress.bytesPerSec
                  )}`}
            </span>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      {status === 'success' && resultUrl && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm dark:border-emerald-900 dark:bg-emerald-950">
          <a href={resultUrl} target="_blank" rel="noreferrer" className="font-mono text-emerald-800 underline dark:text-emerald-300">
            {resultUrl}
          </a>
          <CopyLinkButton
            url={resultUrl}
            className="rounded-full bg-emerald-100 px-3 py-1 text-xs text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-900 dark:text-emerald-200"
          />
        </div>
      )}
    </div>
  );
}

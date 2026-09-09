'use client';

import { useFormStatus } from 'react-dom';
import Spinner from '@/components/Spinner';

// A "bola" fica com o servidor entre o clique e a resposta da server
// action -- useFormStatus() e a unica forma de saber isso sem estado
// proprio, porque ele acompanha o <form> pai automaticamente, mesmo com
// varios forms na mesma pagina (o problema original: salvar o backup do
// us nao dava nenhum sinal de que algo tinha acontecido).
export default function SubmitButton({
  children,
  className = '',
  onClick,
  formAction,
}: {
  children: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  // Formulário com mais de uma ação (ex.: "Salvar" fica no <form action>,
  // "Concluir" sobrescreve com a própria) -- o atributo nativo já resolve
  // qual server action roda por botão, sem precisar de dois <form>.
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      formAction={formAction}
      disabled={pending}
      aria-busy={pending}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 disabled:cursor-wait disabled:opacity-70 ${className}`}
    >
      {pending && <Spinner />}
      {children}
    </button>
  );
}

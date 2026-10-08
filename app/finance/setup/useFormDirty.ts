'use client';

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// "Tem alteração não salva?" comparando o que o form ENVIARIA agora com o
// que enviou no último salvamento -- o próprio FormData, não um espelho do
// estado de cada aba. Assim vale igual pros forms controlados (despesas,
// cartões, parcelas) e pro não controlado (perfil, defaultValue), e
// desfazer uma edição à mão volta a "sem alteração".
//
// É o que decide o Concluir: sem alteração ele só navega, em vez de
// reenviar o form -- reenviar foi o que gravou dados errados em 08/10
// (ver keepFormValues).
function snapshot(form: HTMLFormElement | null): string {
  if (!form) return '';
  return JSON.stringify(
    Array.from(new FormData(form), ([k, v]) => [k, typeof v === 'string' ? v : v.name]),
  );
}

export function useFormDirty(formRef: RefObject<HTMLFormElement | null>) {
  const baseline = useRef<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const check = useCallback(() => {
    if (baseline.current === null) return;
    setDirty(snapshot(formRef.current) !== baseline.current);
  }, [formRef]);

  // Foto inicial depois do primeiro commit, quando o DOM já tem os valores.
  useEffect(() => {
    baseline.current = snapshot(formRef.current);
  }, [formRef]);

  // Sem deps de propósito: linha adicionada/removida não dispara evento de
  // input, só re-render. Comparar uma string pequena por render é barato, e
  // setDirty com o mesmo valor não re-renderiza.
  useEffect(check);

  const markSaved = useCallback(() => {
    baseline.current = snapshot(formRef.current);
    setDirty(false);
  }, [formRef]);

  // `check` também vai no onInput do form: no perfil (não controlado)
  // digitar não re-renderiza nada.
  return { dirty, check, markSaved };
}

'use client';

import React from 'react';
import { evalExpression } from '@/lib/finance/eval-expression';

export interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type' | 'inputMode'> {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  onEscape?: () => void;
}

// Digitação direta: ponto ou vírgula como decimal, expressões +-*/() via
// evalExpression. Ao sair do campo, resolve o valor digitado (número puro
// ou expressão) para o formato final com 2 casas.
const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, onEnter, onEscape, onKeyDown: externalOnKeyDown, onBlur: externalOnBlur, onFocus: externalOnFocus, ...rest },
  forwardedRef
) {
  // Abre com o valor inteiro selecionado. Estes campos sempre nascem
  // preenchidos com o valor cheio (fatura fechada, valor previsto da
  // despesa) e o caso comum e' SUBSTITUIR por quanto se vai pagar de fato
  // -- com o cursor no fim era preciso apagar digito por digito antes de
  // conseguir digitar.
  //
  // O select vai num rAF porque o toque/clique que deu o foco reposiciona
  // o cursor DEPOIS do onFocus; selecionar na hora seria desfeito no
  // mesmo gesto. Continua dando pra editar no meio do numero: basta um
  // segundo toque, que ai nao passa mais por focus.
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    externalOnFocus?.(e);
    if (e.defaultPrevented) return;
    const el = e.currentTarget;
    requestAnimationFrame(() => {
      try { el.select(); } catch { /* campo pode ter saido da tela */ }
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    externalOnKeyDown?.(e);
    if (e.defaultPrevented) return;
    if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); return; }
    if (e.key === 'Escape') { e.preventDefault(); onEscape?.(); return; }
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    externalOnBlur?.(e);
    // Só resolve quando termina em digito ou ')', pra nao mexer em
    // expressao incompleta (ex.: "100+") enquanto o usuario ainda digita.
    const trimmed = value.trim();
    if (trimmed && /[\d)]$/.test(trimmed)) {
      onChange(evalExpression(trimmed).toFixed(2));
    }
  };

  return (
    <input
      ref={forwardedRef}
      type="text"
      inputMode="decimal"
      value={value}
      onChange={e => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      onFocus={handleFocus}
      {...rest}
    />
  );
});

export default MoneyInput;

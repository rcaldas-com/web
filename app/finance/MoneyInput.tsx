'use client';

import React from 'react';
import { evalExpression } from '@/lib/finance/eval-expression';

export interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type' | 'inputMode'> {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  onEscape?: () => void;
  /**
   * Abre com o valor inteiro selecionado, pro primeiro digito ja substituir
   * tudo. Vale so' pra campo de DESPESA, onde o valor digitado costuma ser
   * outro numero por inteiro (pagou parte, e a parte nao tem relacao com o
   * total) -- ali o cursor no fim obrigava a apagar digito por digito.
   *
   * Fatura e saldo ficam de fora de proposito: neles o comum e' somar ou
   * subtrair a partir do valor atual, com o + ou - do teclado de operadores.
   * Selecionar tudo destruiria justamente o numero que se quer ajustar.
   */
  selectOnFocus?: boolean;
}

// Digitação direta: ponto ou vírgula como decimal, expressões +-*/() via
// evalExpression. Ao sair do campo, resolve o valor digitado (número puro
// ou expressão) para o formato final com 2 casas.
const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, onEnter, onEscape, selectOnFocus = false, onKeyDown: externalOnKeyDown, onBlur: externalOnBlur, onFocus: externalOnFocus, ...rest },
  forwardedRef
) {
  // O select vai num rAF porque o toque/clique que deu o foco reposiciona
  // o cursor DEPOIS do onFocus; selecionar na hora seria desfeito no
  // mesmo gesto. Continua dando pra editar no meio do numero: basta um
  // segundo toque, que ai nao passa mais por focus.
  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    externalOnFocus?.(e);
    if (!selectOnFocus || e.defaultPrevented) return;
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

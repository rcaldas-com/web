'use client';

import React, { useRef } from 'react';
import { evalExpression } from '@/lib/finance/eval-expression';

// Pure number if it matches: optional leading minus, digits and at most one decimal point
const isPureNumber = (text: string): boolean => /^-?\d*\.?\d*$/.test(text.trim());

// Convert displayed text to integer cents
const getCents = (text: string): number => {
  const n = parseFloat(text.replace(/,/g, '.'));
  return isNaN(n) ? 0 : Math.round(Math.abs(n) * 100);
};

export interface MoneyInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type' | 'inputMode'> {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  onEscape?: () => void;
}

// Bank-style money input:
// • Number mode (no operators): digits accumulate right-to-left (like Nubank/Itaú)
//   First digit press resets value to start fresh (0.01), subsequent digits accumulate.
//   Backspace removes last digit.
// • Expression mode (once +−×÷ or () appear): regular text input.
//   On blur, auto-evaluates and converts back to number format.
const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(function MoneyInput(
  { value, onChange, onEnter, onEscape, onKeyDown: externalOnKeyDown, onBlur: externalOnBlur, ...rest },
  ref
) {
  // Track whether we're in the "initial" state (first keypress resets value)
  const isInitial = useRef(true);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    externalOnKeyDown?.(e);
    if (e.defaultPrevented) return;

    if (e.key === 'Enter') { e.preventDefault(); onEnter?.(); return; }
    if (e.key === 'Escape') { e.preventDefault(); onEscape?.(); return; }

    if (isPureNumber(value)) {
      if (/^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const digit = parseInt(e.key, 10);
        if (isInitial.current) {
          // First digit: start fresh (bank app behavior)
          isInitial.current = false;
          onChange((digit / 100).toFixed(2));
        } else {
          const newCents = Math.min(getCents(value) * 10 + digit, 9_999_999); // cap at 99999.99
          onChange((newCents / 100).toFixed(2));
        }
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        isInitial.current = false;
        onChange((Math.floor(getCents(value) / 10) / 100).toFixed(2));
      } else if (/^[+\-*/()]$/.test(e.key)) {
        // Switch to expression mode by appending the operator
        e.preventDefault();
        isInitial.current = false;
        onChange(value + e.key);
      } else if (e.key === 'Delete') {
        e.preventDefault();
        isInitial.current = true;
        onChange('0.00');
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && e.key !== 'Tab') {
        e.preventDefault(); // block non-numeric, non-operator printable chars
      }
    }
    // In expression mode: let browser handle all keystrokes (standard text input)
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    // In expression mode (value has operators), reflect browser edits
    if (!isPureNumber(value) || !isPureNumber(e.target.value)) {
      isInitial.current = false;
      onChange(e.target.value);
    }
    // In number mode, all changes go through keyDown — ignore redundant onChange
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    externalOnBlur?.(e);
    // Auto-evaluate expression on blur and format as number
    if (!isPureNumber(value)) {
      const result = evalExpression(value);
      isInitial.current = true;
      onChange(result.toFixed(2));
    }
  };

  return (
    <input
      ref={ref}
      type="text"
      inputMode="decimal"
      value={value}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={handleBlur}
      {...rest}
    />
  );
});

export default MoneyInput;

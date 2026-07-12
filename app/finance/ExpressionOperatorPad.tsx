'use client';

const OPERATORS = [
  { label: '+', value: '+' },
  { label: '-', value: '-' },
  { label: '*', value: '*' },
  { label: '/', value: '/' },
  { label: '(', value: '(' },
  { label: ')', value: ')' },
];

export function insertExpressionToken(
  input: HTMLInputElement | null,
  value: string,
  setValue: (value: string) => void,
  token: string,
) {
  const start = input?.selectionStart ?? value.length;
  const end = input?.selectionEnd ?? value.length;
  const nextValue = `${value.slice(0, start)}${token}${value.slice(end)}`;
  setValue(nextValue);

  requestAnimationFrame(() => {
    input?.focus();
    input?.setSelectionRange(start + token.length, start + token.length);
  });
}

// Like insertExpressionToken but aware of MoneyInput's number mode:
// if the current value is a plain number (no operators), appends the token at the end
// instead of at the cursor (which may be inside the formatted number).
export function insertMoneyToken(
  input: HTMLInputElement | null,
  value: string,
  setValue: (value: string) => void,
  token: string,
) {
  if (/^-?\d*\.?\d*$/.test(value.trim())) {
    // Pure number mode — append to end (triggers expression mode in MoneyInput)
    const next = value.trim() + token;
    setValue(next);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(next.length, next.length);
    });
  } else {
    insertExpressionToken(input, value, setValue, token);
  }
}

export default function ExpressionOperatorPad({ onInsert }: { onInsert: (token: string) => void }) {
  return (
    <div className="mt-1 grid grid-cols-6 gap-1 md:hidden">
      {OPERATORS.map(operator => (
        <button
          key={operator.value}
          type="button"
          onMouseDown={e => e.preventDefault()} // prevent stealing focus from the input
          onClick={() => onInsert(operator.value)}
          className="h-8 rounded border border-zinc-200 bg-zinc-50 px-2 text-sm font-semibold text-zinc-700 shadow-sm transition active:scale-95 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-100"
          aria-label={`Inserir ${operator.label}`}
        >
          {operator.label}
        </button>
      ))}
    </div>
  );
}

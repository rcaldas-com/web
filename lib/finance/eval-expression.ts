/**
 * Avalia uma expressão numérica simples (+-*\/).
 * Aceita vírgula ou ponto como separador decimal.
 * Exemplos: "900,49+100" → 1000.49, "1200-50.5" → 1149.5
 */
export function evalExpression(input: string): number {
  if (!input || !input.trim()) return 0;

  // Normaliza: vírgula → ponto
  const normalized = input.replace(/,/g, '.');

  // Remove espaços
  const clean = normalized.replace(/\s/g, '');

  // Valida: só permite dígitos, ponto, e operadores +-*/
  if (!/^[\d.+\-*/()]+$/.test(clean)) return parseFloat(clean) || 0;

  try {
    // Tokeniza e calcula respeitando precedência
    const result = calculate(clean);
    return isFinite(result) ? Math.round(result * 100) / 100 : 0;
  } catch {
    return parseFloat(clean) || 0;
  }
}

// Parser seguro sem eval()
function calculate(expr: string): number {
  let pos = 0;

  function parseExpression(): number {
    let result = parseTerm();
    while (pos < expr.length) {
      if (expr[pos] === '+') { pos++; result += parseTerm(); }
      else if (expr[pos] === '-') { pos++; result -= parseTerm(); }
      else break;
    }
    return result;
  }

  function parseTerm(): number {
    let result = parseFactor();
    while (pos < expr.length) {
      if (expr[pos] === '*') { pos++; result *= parseFactor(); }
      else if (expr[pos] === '/') { pos++; result /= parseFactor(); }
      else break;
    }
    return result;
  }

  function parseFactor(): number {
    // Unary minus
    if (expr[pos] === '-') { pos++; return -parseFactor(); }
    if (expr[pos] === '+') { pos++; return parseFactor(); }

    // Parentheses
    if (expr[pos] === '(') {
      pos++; // skip (
      const result = parseExpression();
      pos++; // skip )
      return result;
    }

    // Number
    const start = pos;
    while (pos < expr.length && (expr[pos] >= '0' && expr[pos] <= '9' || expr[pos] === '.')) {
      pos++;
    }
    return parseFloat(expr.substring(start, pos)) || 0;
  }

  return parseExpression();
}

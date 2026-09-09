'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// Confirmação visual do "Salvar" no modo convidado: a gravação é local e
// instantânea (localStorage, sem rede) -- não passa pelo useFormStatus que
// dá o spinner no caminho autenticado, então sem isso o clique não dava
// nenhum sinal de que funcionou. Mesma lição do botão de promover no
// Monitor: clique sem resposta faz duvidar se foi mesmo executado.
export function useSavedFlash() {
  const [saved, setSaved] = useState(false);
  const timeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timeout.current), []);

  const flash = useCallback(() => {
    setSaved(true);
    clearTimeout(timeout.current);
    timeout.current = setTimeout(() => setSaved(false), 2000);
  }, []);

  return [saved, flash] as const;
}

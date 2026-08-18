'use client';

import SubmitButton from '@/components/SubmitButton';

// Botao de submit que exige confirmacao antes de enviar o form. Usado
// sempre que apagar/desfazer algo tem custo real de reconfiguracao --
// o exemplo original e apagar host no Monitor: o host reaparece sozinho
// no proximo heartbeat, mas SEM tunnelPort (pode ganhar outra porta e
// quebrar os aliases de ssh), SEM thresholds (para de alertar, calado) e
// SEM config de DDNS/backup -- ou seja, parece recuperado e nao esta.
export default function ConfirmSubmit({
  message,
  children,
  className,
}: {
  message: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <SubmitButton
      className={className}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </SubmitButton>
  );
}

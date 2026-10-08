import type { FormEvent } from 'react';

// O React 19 chama form.reset() quando uma server action passada em
// `action`/`formAction` termina. Nestes formulários os <select>/<input> são
// CONTROLADOS pelo estado: o reset devolve o DOM pra primeira opção
// ("Cartão", "Fixo") sem o estado saber, a tela continua parecendo certa
// pra quem não repara, e o PRÓXIMO envio grava o que o DOM diz.
//
// Aconteceu em 08/10/2026: Salvar gravou certo, um segundo envio 1s depois
// virou 10 despesas de "à vista" pra "cartão" e 3 de proporcional pra fixo.
// O evento reset é cancelável -- cancelar mantém o que está na tela, que é
// exatamente o que acabou de ser salvo.
export function keepFormValues(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
}

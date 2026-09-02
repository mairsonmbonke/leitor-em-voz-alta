/**
 * Onde cada palavra cai dentro do áudio de uma frase.
 *
 * A voz natural devolve o áudio pronto, sem dizer em que instante cada palavra
 * é falada. Para o destaque continuar acompanhando a leitura, o tempo da frase
 * é repartido entre as palavras: palavras mais longas ficam mais tempo em cena,
 * e a pontuação ganha um respiro a mais, que é o que a voz realmente faz.
 *
 * É uma aproximação — pode desencontrar algumas décimos de segundo no meio de
 * uma frase muito longa —, mas a frase inteira também fica realçada, então a
 * pessoa nunca perde a linha que está sendo lida.
 */

import type { Palavra } from './leitura'

/** Instante de início e de fim de uma palavra, em segundos. */
export interface Tempo {
  inicio: number
  fim: number
}

/** Respiro extra, em "letras equivalentes", depois de cada pontuação. */
const PAUSAS: Record<string, number> = {
  ',': 2,
  ';': 3,
  ':': 3,
  '.': 4,
  '!': 4,
  '?': 4,
  '…': 5,
  '—': 2,
}

/** Peso de uma palavra: o tamanho dela mais o respiro da pontuação. */
function peso(texto: string): number {
  let total = texto.length
  for (const letra of texto.slice(-3)) total += PAUSAS[letra] ?? 0
  return total
}

/** Reparte a duração do áudio entre as palavras da frase. */
export function distribuirTempos(palavras: Palavra[], duracao: number): Tempo[] {
  if (palavras.length === 0 || !Number.isFinite(duracao) || duracao <= 0) return []

  const pesos = palavras.map((palavra) => peso(palavra.texto))
  const soma = pesos.reduce((total, valor) => total + valor, 0)
  if (soma === 0) return []

  const tempos: Tempo[] = []
  let inicio = 0
  for (let i = 0; i < pesos.length; i += 1) {
    // A última fecha exatamente no fim, sem sobra de arredondamento.
    const fim = i === pesos.length - 1 ? duracao : inicio + (pesos[i] / soma) * duracao
    tempos.push({ inicio, fim })
    inicio = fim
  }
  return tempos
}

/**
 * Qual palavra está sendo falada neste instante. Devolve -1 antes da primeira
 * e a última quando o tempo passa do fim.
 */
export function palavraNoTempo(tempos: Tempo[], instante: number): number {
  if (tempos.length === 0) return -1
  if (instante < 0) return -1
  if (instante >= tempos[tempos.length - 1].fim) return tempos.length - 1

  let inicio = 0
  let fim = tempos.length - 1
  while (inicio <= fim) {
    const meio = (inicio + fim) >> 1
    if (instante < tempos[meio].inicio) fim = meio - 1
    else if (instante >= tempos[meio].fim) inicio = meio + 1
    else return meio
  }
  return Math.min(inicio, tempos.length - 1)
}

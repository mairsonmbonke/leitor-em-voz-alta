/**
 * Preparo do texto para a leitura em voz alta.
 *
 * O texto é quebrado em **trechos** — normalmente uma frase — e cada trecho
 * guarda a posição exata em que começa e termina no texto original. São essas
 * posições que ligam as três partes da página: o que está sendo falado, o que
 * está destacado na tela e o ponto em que a leitura recomeça quando alguém
 * clica numa palavra.
 *
 * Falar frase a frase (em vez de mandar o texto inteiro de uma vez) também
 * contorna o limite que os navegadores impõem a falas longas e deixa a troca
 * de velocidade, de voz ou de ponto de leitura quase instantânea.
 */

/** Um pedaço do texto que vira uma fala só. */
export interface Trecho {
  /** Posição na lista de trechos. */
  indice: number
  /** Primeiro caractere do trecho no texto original. */
  inicio: number
  /** Um depois do último caractere do trecho no texto original. */
  fim: number
  texto: string
  /** A qual parágrafo o trecho pertence. */
  paragrafo: number
}

/** Uma palavra clicável, com a posição dela no texto original. */
export interface Palavra {
  inicio: number
  fim: number
  texto: string
}

/** Acima disso, um trecho é quebrado mesmo sem pontuação final. */
const MAX_TRECHO = 180
/** Abaixo disso, não vale a pena quebrar um trecho longo. */
const MIN_TRECHO = 40

/** Pontuação que encerra uma frase. */
const PONTUACAO_FINAL = '.!?…'
/** Fecha-aspas e parênteses que ainda pertencem à frase anterior. */
const FECHAMENTOS = '"\'”’»)]}'
/** Pontuação por onde um trecho longo pode ser quebrado. */
const PAUSAS = ',;:—–'

/**
 * Palavras que terminam em ponto sem terminar a frase. Sem essa lista, "Dr.
 * Silva" viraria duas falas com uma pausa no meio do nome.
 */
const ABREVIACOES = new Set([
  'sr', 'sra', 'srta', 'dr', 'dra', 'prof', 'profa', 'eng', 'exmo', 'exma',
  'av', 'r', 'pç', 'ltda', 'cia', 'etc', 'ex', 'obs', 'pág', 'pag', 'fig',
  'núm', 'num', 'no', 'nº', 'vol', 'cap', 'art', 'séc', 'sec', 'ed',
  'mr', 'mrs', 'ms', 'st', 'jr', 'vs', 'inc', 'approx', 'fig', 'eg', 'ie',
  'ud', 'uds', 'sres', 'ing', 'lic', 'pág',
])

function ehEspaco(c: string): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ' '
}

/**
 * O ponto encerra mesmo a frase? Não encerra depois de uma abreviação
 * conhecida ("Dr. Silva") nem depois de uma inicial isolada ("J. R. Tolkien").
 */
function encerraFrase(texto: string, posPonto: number): boolean {
  let fim = posPonto
  while (fim > 0 && /[\p{L}\p{N}]/u.test(texto[fim - 1])) fim -= 1
  const palavra = texto.slice(fim, posPonto)
  if (palavra.length === 0) return true
  if (palavra.length === 1 && palavra === palavra.toUpperCase()) return false
  return !ABREVIACOES.has(palavra.toLowerCase())
}

/**
 * Frase nova começa com maiúscula, número ou aspas. Uma minúscula logo depois
 * da pontuação indica que ela estava no meio da frase ("Depois... nada").
 */
function comecaFrase(texto: string, pos: number): boolean {
  let i = pos
  while (i < texto.length && ehEspaco(texto[i])) i += 1
  if (i >= texto.length) return true
  return !/\p{Ll}/u.test(texto[i])
}

/** Corta um trecho comprido demais em pedaços de tamanho confortável. */
function quebrarLongo(texto: string, inicio: number, fim: number, saida: Array<[number, number]>): void {
  let pos = inicio
  while (fim - pos > MAX_TRECHO) {
    const limite = pos + MAX_TRECHO
    let corte = -1

    // Preferência 1: uma vírgula (ou similar) seguida de espaço.
    for (let i = limite; i > pos + MIN_TRECHO; i -= 1) {
      if (PAUSAS.includes(texto[i - 1]) && ehEspaco(texto[i])) {
        corte = i
        break
      }
    }
    // Preferência 2: qualquer espaço.
    if (corte < 0) {
      for (let i = limite; i > pos + MIN_TRECHO; i -= 1) {
        if (ehEspaco(texto[i])) {
          corte = i
          break
        }
      }
    }
    // Palavra gigante sem espaço nenhum: corta na marra.
    if (corte < 0) corte = limite

    saida.push([pos, corte])
    pos = corte
    while (pos < fim && ehEspaco(texto[pos])) pos += 1
  }
  if (pos < fim) saida.push([pos, fim])
}

/**
 * Quebra o texto em trechos de leitura, preservando as posições originais.
 *
 * Cada linha não vazia é um parágrafo; dentro dele, a divisão segue a
 * pontuação final e, se ainda assim o trecho ficar longo demais, as vírgulas
 * e os espaços.
 */
export function segmentar(texto: string): Trecho[] {
  const trechos: Trecho[] = []
  let paragrafo = 0

  for (const linha of texto.matchAll(/[^\n]+/g)) {
    const base = linha.index
    const conteudo = linha[0]
    if (conteudo.trim().length === 0) continue

    // 1. Corta nas pontuações que realmente terminam uma frase.
    const frases: Array<[number, number]> = []
    let inicioFrase = 0
    for (let i = 0; i < conteudo.length; i += 1) {
      if (!PONTUACAO_FINAL.includes(conteudo[i])) continue
      if (!encerraFrase(conteudo, i)) continue

      let fim = i + 1
      while (fim < conteudo.length && PONTUACAO_FINAL.includes(conteudo[fim])) fim += 1
      while (fim < conteudo.length && FECHAMENTOS.includes(conteudo[fim])) fim += 1
      if (fim < conteudo.length && !ehEspaco(conteudo[fim])) continue
      if (!comecaFrase(conteudo, fim)) continue

      frases.push([inicioFrase, fim])
      inicioFrase = fim
      i = fim - 1
    }
    if (inicioFrase < conteudo.length) frases.push([inicioFrase, conteudo.length])

    // 2. Tira os espaços das pontas e quebra o que ficou comprido demais.
    const pedacos: Array<[number, number]> = []
    for (const [de, ate] of frases) {
      let i = de
      let f = ate
      while (i < f && ehEspaco(conteudo[i])) i += 1
      while (f > i && ehEspaco(conteudo[f - 1])) f -= 1
      if (i >= f) continue
      quebrarLongo(conteudo, i, f, pedacos)
    }

    for (const [de, ate] of pedacos) {
      let f = ate
      while (f > de && ehEspaco(conteudo[f - 1])) f -= 1
      if (f <= de) continue
      trechos.push({
        indice: trechos.length,
        inicio: base + de,
        fim: base + f,
        texto: conteudo.slice(de, f),
        paragrafo,
      })
    }

    paragrafo += 1
  }

  return trechos
}

/** Separa um trecho em palavras clicáveis, com as posições no texto original. */
export function dividirEmPalavras(trecho: Trecho): Palavra[] {
  const palavras: Palavra[] = []
  for (const achado of trecho.texto.matchAll(/\S+/g)) {
    palavras.push({
      inicio: trecho.inicio + achado.index,
      fim: trecho.inicio + achado.index + achado[0].length,
      texto: achado[0],
    })
  }
  return palavras
}

/**
 * Qual trecho leva a leitura a partir desta posição: o que contém a posição
 * ou, se ela cair num espaço entre trechos, o próximo. Devolve -1 quando não
 * há mais nada para ler.
 */
export function trechoNaPosicao(trechos: Trecho[], posicao: number): number {
  for (const trecho of trechos) {
    if (posicao < trecho.fim) return trecho.indice
  }
  return -1
}

/** Progresso da leitura, de 0 a 1. */
export function progresso(trechos: Trecho[], posicao: number): number {
  if (trechos.length === 0) return 0
  const inicio = trechos[0].inicio
  const fim = trechos[trechos.length - 1].fim
  if (fim <= inicio) return 0
  return Math.min(1, Math.max(0, (posicao - inicio) / (fim - inicio)))
}

export function contarPalavras(texto: string): number {
  return texto.match(/\S+/g)?.length ?? 0
}

/** Estimativa de duração da leitura, em segundos. */
export function estimarSegundos(palavras: number, velocidade: number): number {
  const porMinuto = 165 * velocidade
  return porMinuto > 0 ? (palavras / porMinuto) * 60 : 0
}

export const VELOCIDADE_MIN = 0.5
export const VELOCIDADE_MAX = 2
export const VELOCIDADE_PADRAO = 1

export function limitarVelocidade(valor: number): number {
  if (!Number.isFinite(valor)) return VELOCIDADE_PADRAO
  return Math.min(VELOCIDADE_MAX, Math.max(VELOCIDADE_MIN, Math.round(valor * 20) / 20))
}

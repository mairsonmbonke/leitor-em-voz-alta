/**
 * Tradução do texto entre os quatro idiomas da página.
 *
 * Duas origens, nesta ordem:
 *
 * 1. **O tradutor do próprio navegador** (`Translator`, nos Chrome e Edge
 *    recentes). Roda no aparelho, é gratuito, não tem limite e funciona sem
 *    internet depois que o modelo do par de idiomas é baixado.
 * 2. **MyMemory**, um serviço gratuito e sem cadastro, para quem não tem o
 *    tradutor embutido — é o caso do iPhone. Tem limite diário por conexão
 *    (alguns milhares de caracteres), e quando ele estoura a página avisa em
 *    vez de falhar em silêncio.
 *
 * Nenhuma das duas pede chave de acesso, então nada precisa ser guardado no
 * código da página.
 *
 * A tradução é feita parágrafo a parágrafo, e é isso que mantém o original e a
 * tradução alinhados lado a lado na tela.
 */

/** Erro com mensagem pronta para mostrar na tela. */
export class ErroDeTraducao extends Error {}

export interface ProgressoTraducao {
  /** De 0 a 1. */
  fracao: number
  paragrafo: number
  total: number
}

export type AoTraduzir = (progresso: ProgressoTraducao) => void

/** Pedaço máximo aceito pelo MyMemory numa requisição. */
const MAXIMO_POR_PEDIDO = 450

// ── Descoberta do idioma ──────────────────────────────────────────────

/**
 * Palavras curtas e muito comuns em cada idioma. Bastam para separar
 * português, inglês, espanhol e alemão com boa margem, sem baixar nada.
 */
const MARCAS: Record<string, string[]> = {
  'pt-BR': [
    'que', 'não', 'uma', 'com', 'para', 'como', 'mais', 'quando', 'você', 'está', 'são', 'pelo', 'muito', 'já',
    'do', 'da', 'dos', 'das', 'ao', 'pela', 'seu', 'sua', 'ele', 'ela', 'isso', 'também', 'foi', 'ser', 'mesmo',
  ],
  'en-US': [
    'the', 'and', 'that', 'with', 'for', 'this', 'from', 'have', 'they', 'which', 'was', 'you', 'about',
    'of', 'to', 'is', 'are', 'it', 'not', 'but', 'their', 'would', 'there',
  ],
  'es-ES': [
    'que', 'los', 'una', 'con', 'para', 'como', 'pero', 'este', 'sus', 'muy', 'cuando', 'porque', 'está',
    'del', 'las', 'sin', 'son', 'más', 'ellos', 'ella', 'fue', 'nada', 'aquí',
  ],
  'de-DE': [
    'der', 'die', 'das', 'und', 'nicht', 'ist', 'mit', 'für', 'auch', 'sich', 'auf', 'ein', 'eine', 'werden',
    'den', 'dem', 'von', 'zu', 'im', 'aber', 'oder', 'sind', 'wird', 'durch', 'einigen',
  ],
}

/** Letras que praticamente só aparecem num dos idiomas. */
const LETRAS: Record<string, RegExp> = {
  'pt-BR': /[ãõâêôç]/gi,
  'es-ES': /[ñ¿¡]/gi,
  'de-DE': /[äöüß]/gi,
}

/**
 * Adivinha em qual dos quatro idiomas o texto está. Devolve `null` quando o
 * texto é curto ou ambíguo demais para arriscar.
 */
export function detectarIdioma(texto: string): string | null {
  const palavras = texto.toLowerCase().match(/\p{L}+/gu)
  if (!palavras || palavras.length < 5) return null

  const amostra = palavras.slice(0, 400)
  const notas: Record<string, number> = { 'pt-BR': 0, 'en-US': 0, 'es-ES': 0, 'de-DE': 0 }

  for (const palavra of amostra) {
    for (const [idioma, marcas] of Object.entries(MARCAS)) {
      if (marcas.includes(palavra)) notas[idioma] += 1
    }
  }
  for (const [idioma, letras] of Object.entries(LETRAS)) {
    notas[idioma] += (texto.slice(0, 4000).match(letras) ?? []).length * 0.5
  }
  // O alemão escreve todo substantivo com maiúscula: é uma pista forte.
  const maiusculasNoMeio = texto.slice(0, 4000).match(/(?<=\w\s)[A-ZÄÖÜ]\w{3,}/g) ?? []
  notas['de-DE'] += maiusculasNoMeio.length * 0.3

  const ordenadas = Object.entries(notas).sort((a, b) => b[1] - a[1])
  const [melhor, nota] = ordenadas[0]
  const segunda = ordenadas[1][1]
  if (nota < 2 || nota < segunda * 1.3) return null
  return melhor
}

// ── Recorte do texto ──────────────────────────────────────────────────

/** Parágrafos do texto, preservando as linhas em branco entre eles. */
export function emParagrafos(texto: string): string[] {
  return texto
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((linha) => linha.trim())
    .filter((linha) => linha.length > 0)
}

/**
 * Divide um parágrafo em pedaços que caibam num pedido, cortando em fim de
 * frase sempre que possível para não estragar a tradução.
 */
export function dividirParaTraduzir(paragrafo: string, maximo = MAXIMO_POR_PEDIDO): string[] {
  if (paragrafo.length <= maximo) return [paragrafo]

  const pedacos: string[] = []
  let atual = ''
  for (const frase of paragrafo.split(/(?<=[.!?…])\s+/)) {
    if (frase.length > maximo) {
      // Frase gigante: quebra no espaço mais próximo do limite.
      if (atual) {
        pedacos.push(atual)
        atual = ''
      }
      let resto = frase
      while (resto.length > maximo) {
        const corte = resto.lastIndexOf(' ', maximo)
        pedacos.push(resto.slice(0, corte > 0 ? corte : maximo))
        resto = resto.slice(corte > 0 ? corte + 1 : maximo)
      }
      atual = resto
      continue
    }
    if ((atual ? atual.length + 1 : 0) + frase.length > maximo) {
      pedacos.push(atual)
      atual = frase
    } else {
      atual = atual ? `${atual} ${frase}` : frase
    }
  }
  if (atual) pedacos.push(atual)
  return pedacos
}

// ── Tradutor do navegador ─────────────────────────────────────────────

interface TradutorDoNavegador {
  translate: (texto: string) => Promise<string>
  destroy?: () => void
}

interface FabricaDeTradutor {
  availability?: (par: { sourceLanguage: string; targetLanguage: string }) => Promise<string>
  create: (par: { sourceLanguage: string; targetLanguage: string }) => Promise<TradutorDoNavegador>
}

function fabricaDoNavegador(): FabricaDeTradutor | null {
  const janela = globalThis as { Translator?: FabricaDeTradutor; __tradutorDeTeste?: FabricaDeTradutor }
  return janela.__tradutorDeTeste ?? janela.Translator ?? null
}

/** O navegador traduz este par sozinho? */
export async function navegadorTraduz(de: string, para: string): Promise<boolean> {
  const fabrica = fabricaDoNavegador()
  if (!fabrica) return false
  try {
    if (!fabrica.availability) return true
    const situacao = await fabrica.availability({ sourceLanguage: curto(de), targetLanguage: curto(para) })
    return situacao !== 'unavailable'
  } catch {
    return false
  }
}

/** `pt-BR` vira `pt`, que é o que as duas origens esperam. */
function curto(idioma: string): string {
  return idioma.split('-')[0]
}

// ── MyMemory ──────────────────────────────────────────────────────────

interface RespostaMyMemory {
  responseData?: { translatedText?: string }
  responseStatus?: number | string
  responseDetails?: string
}

async function traduzirNoMyMemory(texto: string, de: string, para: string, sinal?: AbortSignal): Promise<string> {
  const endereco =
    'https://api.mymemory.translated.net/get' +
    `?q=${encodeURIComponent(texto)}&langpair=${encodeURIComponent(`${curto(de)}|${curto(para)}`)}`

  let resposta: Response
  try {
    resposta = await fetch(endereco, { signal: sinal })
  } catch {
    if (sinal?.aborted) throw new ErroDeTraducao('Tradução cancelada.')
    throw new ErroDeTraducao('Não foi possível falar com o serviço de tradução. Confira a conexão.')
  }
  if (!resposta.ok) {
    throw new ErroDeTraducao(`O serviço de tradução respondeu com erro (${resposta.status}).`)
  }

  const dados = (await resposta.json()) as RespostaMyMemory
  const traduzido = dados.responseData?.translatedText ?? ''
  const detalhe = dados.responseDetails ?? ''

  if (/MYMEMORY WARNING|QUOTA|LIMIT/i.test(traduzido) || /QUOTA|LIMIT/i.test(detalhe)) {
    throw new ErroDeTraducao(
      'O limite diário gratuito de tradução acabou nesta conexão. Tente de novo amanhã, ' +
        'ou use um navegador com tradutor embutido (Chrome ou Edge no computador).',
    )
  }
  if (!traduzido) throw new ErroDeTraducao('O serviço de tradução devolveu uma resposta vazia.')
  return traduzido
}

// ── Tradução completa ─────────────────────────────────────────────────

/**
 * Traduz uma lista de parágrafos, na ordem, devolvendo outra lista do mesmo
 * tamanho — é isso que permite mostrar original e tradução lado a lado.
 */
export async function traduzirParagrafos(
  paragrafos: string[],
  de: string,
  para: string,
  aoTraduzir?: AoTraduzir,
  sinal?: AbortSignal,
): Promise<string[]> {
  if (curto(de) === curto(para)) {
    throw new ErroDeTraducao('O idioma de origem e o de destino são o mesmo.')
  }

  const fabrica = fabricaDoNavegador()
  let doNavegador: TradutorDoNavegador | null = null
  if (await navegadorTraduz(de, para)) {
    try {
      doNavegador = await fabrica!.create({ sourceLanguage: curto(de), targetLanguage: curto(para) })
    } catch {
      doNavegador = null
    }
  }

  const traduzidos: string[] = []
  try {
    for (let i = 0; i < paragrafos.length; i += 1) {
      if (sinal?.aborted) throw new ErroDeTraducao('Tradução cancelada.')

      const pedacos = dividirParaTraduzir(paragrafos[i])
      const partes: string[] = []
      for (const pedaco of pedacos) {
        if (sinal?.aborted) throw new ErroDeTraducao('Tradução cancelada.')
        partes.push(
          doNavegador ? await doNavegador.translate(pedaco) : await traduzirNoMyMemory(pedaco, de, para, sinal),
        )
      }
      traduzidos.push(partes.join(' '))
      aoTraduzir?.({ fracao: (i + 1) / paragrafos.length, paragrafo: i + 1, total: paragrafos.length })
    }
  } finally {
    doNavegador?.destroy?.()
  }

  return traduzidos
}

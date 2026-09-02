/**
 * Voz natural que roda no próprio aparelho.
 *
 * As vozes do sistema variam muito: no Windows com Edge são ótimas, no iPhone
 * são mecânicas — e não há nada que a página possa fazer quanto a isso, porque
 * o iOS não entrega as vozes boas para a web. A saída que não custa nada, não
 * pede cadastro nem chave e funciona igual em qualquer aparelho é a própria
 * página baixar um modelo de voz (Piper, código aberto) e sintetizar a fala
 * localmente.
 *
 * O modelo é baixado uma vez (~60 MB), fica guardado no navegador e depois
 * funciona até sem internet. A biblioteca só é carregada quando alguém
 * realmente usa essa voz.
 *
 * Três defeitos da biblioteca são contornados aqui, e valem explicação:
 *
 * 1. Ela liga o ONNX em várias linhas de execução (`numThreads` = número de
 *    núcleos). Isso exige `SharedArrayBuffer`, que só existe em páginas com
 *    cabeçalhos de isolamento — que o GitHub Pages não envia. Sem eles a
 *    sessão falha ao ser criada. Aqui o número fica travado em 1.
 * 2. O `download()` dela não espera a gravação terminar: dizia "pronto" antes
 *    de o arquivo estar guardado. Por isso conferimos com `stored()` depois.
 * 3. A sessão é única e não troca o modelo quando o idioma muda — falaria
 *    inglês com o modelo do português. Aqui a sessão é descartada na troca.
 */

export interface VozNatural {
  /** Identificador do modelo no catálogo do Piper. */
  id: string
  /** Idioma a que ela pertence, no mesmo código usado na página. */
  idioma: string
  nome: string
  /** Tamanho do download, em megabytes, para avisar antes de baixar. */
  tamanhoMB: number
}

/**
 * Uma voz por idioma — a de melhor qualidade disponível para cada um. Mais de
 * uma opção só encheria a lista de downloads de 60 MB.
 */
export const VOZES_NATURAIS: VozNatural[] = [
  { id: 'pt_BR-faber-medium', idioma: 'pt-BR', nome: 'Faber (natural, offline)', tamanhoMB: 60 },
  { id: 'en_US-hfc_female-medium', idioma: 'en-US', nome: 'HFC Female (natural, offline)', tamanhoMB: 60 },
  { id: 'es_ES-davefx-medium', idioma: 'es-ES', nome: 'DaveFX (natural, offline)', tamanhoMB: 60 },
  { id: 'de_DE-thorsten-medium', idioma: 'de-DE', nome: 'Thorsten (natural, offline)', tamanhoMB: 60 },
]

export function vozNaturalDoIdioma(idioma: string): VozNatural | null {
  return VOZES_NATURAIS.find((voz) => voz.idioma === idioma) ?? null
}

/** Andamento do download, de 0 a 1. */
export type AoBaixar = (fracao: number) => void

/** Erro com mensagem pronta para mostrar na tela. */
export class ErroDeVoz extends Error {}

/** Uma fala que demora mais que isto travou em algum lugar. */
const LIMITE_DE_ESPERA = 45_000

interface Sessao {
  voiceId: string
  waitReady: Promise<void> | boolean
  predict: (texto: string) => Promise<Blob>
}

/** O pedaço da biblioteca que a página usa. */
interface Motor {
  TtsSession: {
    new (opcoes: { voiceId: string; progress?: (p: { url: string; loaded: number; total: number }) => void }): Sessao
    _instance: Sessao | null
  }
  download: (id: string, progresso: (p: { url: string; loaded: number; total: number }) => void) => Promise<void>
  stored: () => Promise<string[]>
  remove: (id: string) => Promise<void>
}

let motor: Motor | null = null
let sessao: Sessao | null = null
let vozDaSessao = ''

/** Troca o motor por um de mentira. Usado pelos testes de interface. */
export function definirMotor(falso: Motor | null): void {
  motor = falso
  sessao = null
  vozDaSessao = ''
}

async function carregarMotor(): Promise<Motor> {
  // Os testes de interface põem um motor de mentira aqui para exercitar a
  // leitura sem baixar 60 MB de modelo a cada execução.
  const deTeste = (globalThis as { __motorDeVozDeTeste?: Motor }).__motorDeVozDeTeste
  if (deTeste) return deTeste
  if (motor) return motor

  // Antes da biblioteca: o ONNX precisa ficar numa linha de execução só.
  // Ela sobrescreve `numThreads` ao iniciar, então a propriedade é travada.
  try {
    const ort = (await import('onnxruntime-web/wasm')) as unknown as {
      env?: { wasm?: Record<string, unknown> }
    }
    const wasm = ort.env?.wasm
    if (wasm) {
      Object.defineProperty(wasm, 'numThreads', {
        get: () => 1,
        set: () => {},
        configurable: true,
      })
    }
  } catch {
    // Sem o ajuste a biblioteca ainda pode funcionar onde há isolamento.
  }

  motor = (await import('@mintplex-labs/piper-tts-web')) as unknown as Motor
  return motor
}

/** O navegador tem o necessário para rodar a voz natural? */
export function suportaVozNatural(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof WebAssembly === 'object' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  )
}

/** Modelos já baixados neste navegador. */
export async function jaBaixadas(): Promise<string[]> {
  try {
    const lib = await carregarMotor()
    return await lib.stored()
  } catch {
    return []
  }
}

/**
 * Baixa o modelo e guarda no navegador.
 *
 * O `download()` da biblioteca não espera a gravação terminar, então aqui a
 * função só devolve depois de o arquivo aparecer de fato entre os guardados.
 */
export async function baixar(id: string, aoBaixar?: AoBaixar): Promise<void> {
  const lib = await carregarMotor()
  await lib.download(id, ({ loaded, total }) => {
    if (total > 0) aoBaixar?.(Math.min(0.99, loaded / total))
  })

  for (let tentativa = 0; tentativa < 20; tentativa += 1) {
    if ((await lib.stored()).includes(id)) {
      aoBaixar?.(1)
      return
    }
    await new Promise((pronto) => setTimeout(pronto, 250))
  }
  throw new ErroDeVoz('O modelo foi baixado, mas o navegador não conseguiu guardá-lo.')
}

/** Prepara (ou reaproveita) a sessão de síntese desta voz. */
async function pegarSessao(id: string): Promise<Sessao> {
  const lib = await carregarMotor()

  // Trocou de voz: a sessão antiga ainda carrega o modelo anterior.
  if (sessao && vozDaSessao !== id) {
    lib.TtsSession._instance = null
    sessao = null
  }
  if (!sessao) {
    lib.TtsSession._instance = null
    sessao = new lib.TtsSession({ voiceId: id })
    vozDaSessao = id
    try {
      await sessao.waitReady
    } catch (erro) {
      sessao = null
      lib.TtsSession._instance = null
      throw new ErroDeVoz(motivo(erro))
    }
  }
  return sessao
}

/** Transforma a falha da biblioteca numa frase que ajuda quem está lendo. */
function motivo(erro: unknown): string {
  const texto = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro)
  if (/SharedArrayBuffer|cross-origin|isolat/i.test(texto)) {
    return 'Este navegador não deixa a voz natural usar vários núcleos nesta página.'
  }
  if (/fetch|network|Failed to fetch|load/i.test(texto)) {
    return 'Não foi possível baixar as peças da voz natural. Confira a conexão.'
  }
  if (/memory|allocat|OOM/i.test(texto)) {
    return 'O aparelho ficou sem memória para a voz natural.'
  }
  return texto.slice(0, 160)
}

/** Gera o áudio de um trecho de texto. */
export async function sintetizar(id: string, texto: string): Promise<Blob> {
  const atual = await pegarSessao(id)

  // Se a fala travar (a biblioteca tem um caminho em que a promessa nunca se
  // resolve), é melhor um erro claro do que "Preparando…" para sempre.
  let relogio = 0
  const limite = new Promise<never>((_, falhar) => {
    relogio = window.setTimeout(
      () => falhar(new ErroDeVoz('A voz natural demorou demais para responder neste aparelho.')),
      LIMITE_DE_ESPERA,
    )
  })

  try {
    return await Promise.race([atual.predict(texto), limite])
  } catch (erro) {
    // Uma sessão que falhou não costuma se recuperar sozinha.
    sessao = null
    throw erro instanceof ErroDeVoz ? erro : new ErroDeVoz(motivo(erro))
  } finally {
    window.clearTimeout(relogio)
  }
}

/** Apaga o modelo baixado, devolvendo o espaço ao aparelho. */
export async function apagar(id: string): Promise<void> {
  const lib = await carregarMotor()
  if (vozDaSessao === id) {
    sessao = null
    lib.TtsSession._instance = null
  }
  await lib.remove(id)
}

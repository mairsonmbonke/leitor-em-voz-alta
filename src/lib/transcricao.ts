/**
 * Transformar um áudio em texto, dentro do próprio navegador.
 *
 * O modelo é o Whisper (código aberto, da OpenAI), na versão `base`, que baixa
 * uma vez (~80 MB), fica guardado no navegador e depois funciona até sem
 * internet. Não custa nada, não pede cadastro nem chave, e **o áudio não sai do
 * aparelho** — o que importa quando o arquivo é uma conversa particular do
 * WhatsApp.
 *
 * A biblioteca (`@huggingface/transformers`) tem o mesmo defeito que a da voz
 * natural: manda o `onnxruntime-web` buscar o WebAssembly num CDN, no endereço
 * da versão que ela mesma fixou — aqui, uma versão de desenvolvimento. Se esse
 * endereço não existir, a transcrição falha com uma mensagem sobre "rede".
 * Por isso o motor é servido pela própria página, em `public/motor/transcricao/`
 * (ver `scripts/preparar-motor.mjs`).
 */

export class ErroDeTranscricao extends Error {
  detalhe: string

  constructor(mensagem: string, detalhe = '') {
    super(mensagem)
    this.name = 'ErroDeTranscricao'
    this.detalhe = detalhe
    if (detalhe && typeof console !== 'undefined') console.warn('[transcrição]', mensagem, '—', detalhe)
  }
}

/**
 * De onde o modelo pode vir, tentados nesta ordem.
 *
 * É o mesmo modelo (Whisper `base`) publicado em dois acervos, e as duas
 * versões são comprimidas (`q8`) para caber no celular. A ordem não é
 * arbitrária: baixar o arquivo é a parte fácil — a difícil é o motor conseguir
 * montar a sessão com ele.
 *
 * O acervo `onnx-community` publica os pesos num formato de quantização mais
 * novo (blocos, `MatMulNBits`), e o `onnxruntime-web` que vem com a biblioteca
 * recusa esses arquivos com "Missing required scale" — o modelo baixa inteiro e
 * só falha no fim, na hora de abrir. O `Xenova` usa a quantização mais antiga,
 * que roda em WebAssembly há anos. Por isso ele vem primeiro.
 *
 * E a troca acontece em **qualquer** falha, não só quando o arquivo não é
 * encontrado: um modelo que não abre é tão inútil quanto um que não existe.
 */
export const MODELOS = ['Xenova/whisper-base', 'onnx-community/whisper-base']
/** Tamanho aproximado do download, em megabytes, para avisar antes. */
export const TAMANHO_MB_DA_TRANSCRICAO = 80

/** Andamento: baixar o modelo é uma etapa, transcrever é outra. */
export interface AndamentoDaTranscricao {
  etapa: 'modelo' | 'audio' | 'transcrevendo'
  /** De 0 a 1; vale −1 quando não dá para saber. */
  fracao: number
  descricao: string
}

export type AoTranscrever = (andamento: AndamentoDaTranscricao) => void

/** Idioma da página traduzido para o código que o Whisper espera. */
function idiomaDoWhisper(idioma: string): string {
  const curto = idioma.split('-')[0]
  return ['pt', 'en', 'es', 'de'].includes(curto) ? curto : 'pt'
}

/** Endereço da pasta com o motor de transcrição, servida junto com a página. */
function pastaDoMotor(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return new URL(`${base}motor/transcricao/`, location.href).href
}

interface Reconhecedor {
  (
    audio: Float32Array,
    opcoes: Record<string, unknown>,
  ): Promise<{ text?: string } | { text?: string }[]>
  dispose?: () => Promise<void>
}

interface Biblioteca {
  pipeline: (
    tarefa: string,
    modelo: string,
    opcoes?: Record<string, unknown>,
  ) => Promise<Reconhecedor>
  env: {
    backends?: { onnx?: { wasm?: Record<string, unknown> } }
    allowLocalModels?: boolean
  }
}

let biblioteca: Biblioteca | null = null
let reconhecedor: Reconhecedor | null = null

/** Troca o motor por um de mentira. Usado pelos testes de interface. */
function deTeste(): { transcrever: (a: Float32Array, i: string) => Promise<string> } | null {
  return (globalThis as { __motorDeTranscricaoDeTeste?: { transcrever: (a: Float32Array, i: string) => Promise<string> } })
    .__motorDeTranscricaoDeTeste ?? null
}

/** O navegador tem o necessário para transcrever? */
export function suportaTranscricao(): boolean {
  return typeof window !== 'undefined' && typeof WebAssembly === 'object'
}

async function carregarBiblioteca(): Promise<Biblioteca> {
  if (biblioteca) return biblioteca
  const lib = (await import('@huggingface/transformers')) as unknown as Biblioteca

  const wasm = lib.env?.backends?.onnx?.wasm
  if (wasm) {
    // O motor vem da nossa pasta, não de um CDN com versão que pode não existir.
    // Os dois arquivos são nomeados um a um, e não por prefixo: assim fica
    // claro o que é buscado, e nenhuma variante que não publicamos é pedida.
    const pasta = pastaDoMotor()
    wasm.wasmPaths = {
      wasm: `${pasta}ort-wasm-simd-threaded.wasm`,
      mjs: `${pasta}ort-wasm-simd-threaded.mjs`,
    }
    // Sem cabeçalhos de isolamento (o GitHub Pages não os envia) não há
    // `SharedArrayBuffer`, e mais de uma linha de execução só faria falhar.
    wasm.numThreads = 1
    // O modo com trabalhador exige um WebAssembly extra de 23 MB que não vale
    // a pena publicar; sem ele, o caminho simples é o que roda.
    wasm.proxy = false
  }
  lib.env.allowLocalModels = false

  biblioteca = lib
  return lib
}

/** Traduz a falha da biblioteca numa frase que ajuda quem está lendo. */
function comoErro(erro: unknown): ErroDeTranscricao {
  if (erro instanceof ErroDeTranscricao) return erro
  const texto = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro)

  if (/abort|cancel/i.test(texto)) return new ErroDeTranscricao('Transcrição cancelada.', texto)
  if (/out of memory|allocat|RangeError|OOM/i.test(texto)) {
    return new ErroDeTranscricao(
      'O aparelho ficou sem memória para transcrever. Feche outras abas e tente de novo, ' +
        'ou use um áudio mais curto.',
      texto,
    )
  }
  // O motor baixou o modelo inteiro e não conseguiu abri-lo: quantização que
  // esta versão do `onnxruntime-web` não entende.
  if (/create a session|qdq_actions|MatMulNBits|Missing required scale|INVALID_GRAPH|INVALID_PROTOBUF/i.test(texto)) {
    return new ErroDeTranscricao(
      'O modelo de transcrição foi baixado, mas o motor deste navegador não conseguiu abri-lo: ' +
        'o formato comprimido não é compatível.',
      texto,
    )
  }
  if (/wasm|WebAssembly|magic word|compile/i.test(texto)) {
    return new ErroDeTranscricao(
      'O motor de transcrição não pôde ser carregado neste navegador.',
      `${texto} — motor em ${pastaDoMotor()}`,
    )
  }
  // A biblioteca escreve "Could not locate file" no lugar de dizer 404.
  if (/could not locate|404|not found/i.test(texto)) {
    return new ErroDeTranscricao(
      'Uma peça do modelo de transcrição não existe no endereço esperado. Toque em "Ver detalhes" para ' +
        'saber qual arquivo faltou.',
      texto,
    )
  }
  if (/unauthorized|forbidden|401|403/i.test(texto)) {
    return new ErroDeTranscricao('O servidor do modelo de transcrição recusou o download.', texto)
  }
  if (/internal server|bad gateway|service unavailable|50\d/i.test(texto)) {
    return new ErroDeTranscricao('O servidor do modelo de transcrição está fora do ar. Tente mais tarde.', texto)
  }
  if (/fetch|network|Failed to fetch|load/i.test(texto)) {
    return new ErroDeTranscricao(
      'Não foi possível baixar o modelo de transcrição. A internet pode estar funcionando e mesmo assim ' +
        'esse endereço estar bloqueado — é comum em redes de empresa, escola, VPN ou antivírus.',
      texto,
    )
  }
  return new ErroDeTranscricao(
    'A transcrição falhou neste aparelho. Toque em "Ver detalhes" para saber o motivo.',
    texto,
  )
}

/** Prepara (ou reaproveita) o reconhecedor. Baixa o modelo na primeira vez. */
async function pegarReconhecedor(aoAndar?: AoTranscrever): Promise<Reconhecedor> {
  if (reconhecedor) return reconhecedor
  const lib = await carregarBiblioteca()

  // O andamento vem peça por peça; o que interessa mostrar é o total.
  const pesos = new Map<string, { feito: number; total: number }>()
  const progresso = (evento: { status?: string; file?: string; loaded?: number; total?: number }) => {
    if (evento.status !== 'progress' || !evento.file) return
    pesos.set(evento.file, { feito: evento.loaded ?? 0, total: evento.total ?? 0 })
    let feito = 0
    let total = 0
    for (const peca of pesos.values()) {
      feito += peca.feito
      total += peca.total
    }
    aoAndar?.({
      etapa: 'modelo',
      fracao: total > 0 ? Math.min(0.99, feito / total) : -1,
      descricao:
        total > 0
          ? `Baixando o modelo de transcrição: ${(feito / 1024 / 1024).toFixed(1)} MB de ${(total / 1024 / 1024).toFixed(1)} MB`
          : 'Baixando o modelo de transcrição…',
    })
  }

  let ultimo: unknown = null
  for (const modelo of MODELOS) {
    pesos.clear()
    try {
      reconhecedor = await lib.pipeline('automatic-speech-recognition', modelo, {
        // `q8` é a versão comprimida: cabe no celular e é o padrão para
        // WebAssembly. Sem ela o download seria três vezes maior.
        dtype: 'q8',
        device: 'wasm',
        progress_callback: progresso,
      })
      return reconhecedor
    } catch (erro) {
      reconhecedor = null
      ultimo = erro
      const texto = erro instanceof Error ? erro.message : String(erro)
      // Cancelar é uma decisão da pessoa: não se insiste contra ela.
      if (/abort|cancel/i.test(texto)) break
      console.warn('[transcrição] o acervo', modelo, 'não serviu; tentando o próximo —', texto)
      aoAndar?.({
        etapa: 'modelo',
        fracao: -1,
        descricao: 'Esse modelo não abriu neste navegador; tentando outro…',
      })
    }
  }
  throw comoErro(ultimo)
}

/** Junta o texto que o modelo devolve, venha ele em pedaços ou inteiro. */
function juntar(saida: { text?: string } | { text?: string }[]): string {
  const partes = Array.isArray(saida) ? saida : [saida]
  return partes
    .map((parte) => (parte.text ?? '').trim())
    .filter((parte) => parte.length > 0)
    .join(' ')
}

/**
 * O texto do Whisper vem numa linha só. Uma quebra a cada ponto final deixa a
 * leitura em voz alta (e a tradução) com parágrafos de tamanho humano.
 */
export function emParagrafosDeFala(texto: string): string {
  const limpo = texto.replace(/\s+/g, ' ').trim()
  if (limpo.length === 0) return ''

  const frases = limpo.match(/[^.!?…]+[.!?…]*\s*/g) ?? [limpo]
  const paragrafos: string[] = []
  let atual = ''
  for (const frase of frases) {
    atual += frase
    // Três frases por parágrafo dão um bloco confortável de ler e de ouvir.
    if ((atual.match(/[.!?…]/g) ?? []).length >= 3) {
      paragrafos.push(atual.trim())
      atual = ''
    }
  }
  if (atual.trim().length > 0) paragrafos.push(atual.trim())
  return paragrafos.join('\n')
}

/** Transcreve o som já preparado (um canal, 16 kHz). */
export async function transcrever(
  amostras: Float32Array,
  idioma: string,
  aoAndar?: AoTranscrever,
  sinal?: AbortSignal,
): Promise<string> {
  if (sinal?.aborted) throw new ErroDeTranscricao('Transcrição cancelada.')

  const falso = deTeste()
  if (falso) {
    aoAndar?.({ etapa: 'transcrevendo', fracao: 0.5, descricao: 'Transcrevendo o áudio…' })
    return emParagrafosDeFala(await falso.transcrever(amostras, idioma))
  }

  const motor = await pegarReconhecedor(aoAndar)
  if (sinal?.aborted) throw new ErroDeTranscricao('Transcrição cancelada.')

  aoAndar?.({ etapa: 'transcrevendo', fracao: -1, descricao: 'Transcrevendo o áudio…' })

  try {
    const saida = await motor(amostras, {
      language: idiomaDoWhisper(idioma),
      task: 'transcribe',
      // O Whisper só ouve 30 segundos por vez; pedaços com sobreposição evitam
      // que uma palavra partida no meio se perca.
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: false,
    })
    if (sinal?.aborted) throw new ErroDeTranscricao('Transcrição cancelada.')

    const texto = juntar(saida)
    if (texto.length === 0) {
      throw new ErroDeTranscricao(
        'Não encontrei fala neste áudio. Confira se o arquivo tem voz e se o idioma escolhido é o falado nele.',
      )
    }
    return emParagrafosDeFala(texto)
  } catch (erro) {
    throw comoErro(erro)
  }
}

/** Esquece o modelo carregado, devolvendo a memória ao aparelho. */
export async function descartar(): Promise<void> {
  await reconhecedor?.dispose?.().catch(() => undefined)
  reconhecedor = null
}

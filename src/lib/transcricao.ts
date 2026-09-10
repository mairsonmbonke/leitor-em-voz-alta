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

/**
 * A ordem das tentativas.
 *
 * O que derruba a transcrição não é baixar o modelo — é o motor conseguir abrir
 * o arquivo baixado. A compressão `q8` dos acervos atuais usa quantização em
 * blocos (`MatMulNBits`), e o `onnxruntime-web` a recusa com "Missing required
 * scale", em qualquer versão testada e mesmo com o otimizador de grafo
 * desligado. Não adianta insistir nela.
 *
 * `int8` e `uint8` são a compressão antiga, feita valor a valor: não têm blocos,
 * não passam por essa engrenagem e ocupam o mesmo tamanho. Por isso vêm antes.
 * `fp32` é o modelo sem compressão nenhuma — não há o que dar errado, mas são
 * quase 300 MB, então fica por último.
 */
interface Tentativa {
  modelo: string
  tipo: string
  /** Tamanho aproximado do download, para avisar antes de começar. */
  mb: number
}

export const TENTATIVAS: Tentativa[] = [
  { modelo: MODELOS[1], tipo: 'int8', mb: 80 },
  { modelo: MODELOS[1], tipo: 'uint8', mb: 80 },
  { modelo: MODELOS[0], tipo: 'q8', mb: 80 },
  { modelo: MODELOS[1], tipo: 'q8', mb: 80 },
  { modelo: MODELOS[1], tipo: 'fp32', mb: 290 },
]

export const chaveDa = (t: Tentativa) => `${t.modelo}|${t.tipo}`

/**
 * O número no fim das chaves é a versão da lista de tentativas. Ao mudá-la, o
 * histórico antigo deixa de valer sozinho — combinações riscadas por uma versão
 * do código não devem calar tentativas de outra.
 */
const CHAVE_ESCOLHA = 'leitor.transcricao.escolha.2'
const CHAVE_RECUSADAS = 'leitor.transcricao.recusadas.2'

function lerLista(chave: string): string[] {
  try {
    const salvo = JSON.parse(localStorage.getItem(chave) ?? '[]')
    return Array.isArray(salvo) ? salvo.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

function guardarLista(chave: string, lista: string[]): void {
  try {
    localStorage.setItem(chave, JSON.stringify(lista))
  } catch {
    /* navegador com armazenamento bloqueado */
  }
}

/**
 * A ordem de hoje: o que já funcionou neste navegador vem primeiro, e o que já
 * foi recusado sai da frente. Cada tentativa frustrada custa dezenas de
 * megabytes — não vale repeti-las a cada visita.
 */
export function tentativasDeHoje(): Tentativa[] {
  const escolhida = lerLista(CHAVE_ESCOLHA)[0]
  const recusadas = new Set(lerLista(CHAVE_RECUSADAS))
  const vale = TENTATIVAS.filter((t) => !recusadas.has(chaveDa(t)) || chaveDa(t) === escolhida)
  const lista = vale.length > 0 ? vale : TENTATIVAS
  const boa = lista.find((t) => chaveDa(t) === escolhida)
  return boa ? [boa, ...lista.filter((t) => t !== boa)] : lista
}
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
  ModelRegistry?: {
    get_available_dtypes: (modelo: string, opcoes?: Record<string, unknown>) => Promise<string[]>
    get_pipeline_files: (tarefa: string, modelo: string, opcoes?: Record<string, unknown>) => Promise<string[]>
  }
  env: {
    backends?: { onnx?: { wasm?: Record<string, unknown>; versions?: { web?: string } } }
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

  versaoDoMotor = lib.env?.backends?.onnx?.versions?.web ?? null
  biblioteca = lib
  return lib
}

/**
 * O que o motor de transcrição está usando: versão e endereço do WebAssembly.
 *
 * Vai junto na explicação técnica de qualquer falha — foi justamente a versão
 * do motor que causou o problema mais difícil desta função, e sem ela na mão a
 * conversa vira adivinhação.
 */
export async function diagnosticoDoMotor(): Promise<{ versao: string | null; caminhos: unknown }> {
  const lib = await carregarBiblioteca()
  const onnx = lib.env?.backends?.onnx
  return { versao: onnx?.versions?.web ?? null, caminhos: onnx?.wasm?.wasmPaths ?? null }
}

/** A versão do motor, guardada assim que a biblioteca carrega. */
let versaoDoMotor: string | null = null

/**
 * O que já foi tentado nesta busca, e por que cada uma não serviu.
 *
 * Sem isto, todas as tentativas produzem a mesma mensagem na tela e não há como
 * saber qual delas falhou — foi exatamente o que fez esta função ser
 * diagnosticada às cegas por várias rodadas.
 */
let trilha: string[] = []

/** Resume uma falha em duas palavras, para caber na trilha. */
function porQueNaoServiu(texto: string): string {
  if (/could not locate|404|not found/i.test(texto)) return 'não existe'
  if (/create a session|Missing required scale|MatMulNBits|INVALID_GRAPH/i.test(texto)) return 'não abre'
  if (/out of memory|allocat|RangeError/i.test(texto)) return 'sem memória'
  if (/unauthorized|forbidden|401|403/i.test(texto)) return 'recusado'
  if (/fetch|network/i.test(texto)) return 'sem resposta'
  return texto.replace(/\s+/g, ' ').slice(0, 40)
}

/** Traduz a falha da biblioteca numa frase que ajuda quem está lendo. */
function comoErro(erro: unknown): ErroDeTranscricao {
  if (erro instanceof ErroDeTranscricao) return erro
  const cru = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro)
  // A versão do motor entra em toda explicação técnica: foi ela a causa do
  // problema mais difícil desta função.
  const partes = [cru]
  if (versaoDoMotor) partes.push(`[motor ${versaoDoMotor}]`)
  if (trilha.length > 0) partes.push(`[tentativas: ${trilha.join('; ')}]`)
  const texto = partes.join(' ')

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
  let tamanhoEsperado = TENTATIVAS[0].mb
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
          : `Baixando o modelo de transcrição (cerca de ${tamanhoEsperado} MB)…`,
    })
  }

  const fila = tentativasDeHoje()
  let ultimo: unknown = null
  trilha = []

  for (let i = 0; i < fila.length; i += 1) {
    const tentativa = fila[i]
    pesos.clear()
    tamanhoEsperado = tentativa.mb
    try {
      reconhecedor = await lib.pipeline('automatic-speech-recognition', tentativa.modelo, {
        dtype: tentativa.tipo,
        device: 'wasm',
        progress_callback: progresso,
      })
      // Guarda a que funcionou: nas próximas visitas ela vem primeiro.
      guardarLista(CHAVE_ESCOLHA, [chaveDa(tentativa)])
      return reconhecedor
    } catch (erro) {
      reconhecedor = null
      ultimo = erro
      const texto = erro instanceof Error ? erro.message : String(erro)
      // Cancelar é uma decisão da pessoa: não se insiste contra ela.
      if (/abort|cancel/i.test(texto)) break

      const motivo = porQueNaoServiu(texto)
      trilha.push(`${tentativa.tipo} em ${tentativa.modelo.split('/')[0]}: ${motivo}`)
      console.warn('[transcrição]', chaveDa(tentativa), '—', motivo, '—', texto)

      // Um formato que não existe naquele acervo não precisa ser tentado de
      // novo; um que não abriu, também não. Os dois são riscados.
      guardarLista(CHAVE_RECUSADAS, [...new Set([...lerLista(CHAVE_RECUSADAS), chaveDa(tentativa)])])

      const proxima = fila[i + 1]
      if (proxima) {
        aoAndar?.({
          etapa: 'modelo',
          fracao: -1,
          descricao:
            `Este modelo não abriu neste navegador. Tentando outro` +
            (proxima.mb > 150 ? ` (sem compressão, ${proxima.mb} MB)` : '') +
            '…',
        })
      }
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

/**
 * Pergunta ao servidor **quais arquivos** cada formato resolveria, sem baixar
 * nenhum deles.
 *
 * Existe por um motivo concreto: as tentativas todas falhavam com a mesma
 * mensagem, inclusive a do modelo sem compressão — que não tem peso quantizado
 * e portanto não podia dar aquele erro. Ou o formato pedido não chega ao arquivo
 * carregado, ou o arquivo não é o que o nome diz. Esta função mostra os nomes
 * de verdade, e custa alguns kilobytes em vez de 80 MB.
 */
export async function conferirModelos(): Promise<string> {
  const lib = await carregarBiblioteca()
  const registro = lib.ModelRegistry
  const linhas: string[] = [`motor ${versaoDoMotor ?? 'desconhecido'}`]

  if (!registro?.get_pipeline_files) {
    return [...linhas, 'esta versão da biblioteca não sabe listar os arquivos'].join('\n')
  }

  for (const modelo of MODELOS) {
    try {
      const tipos = await registro.get_available_dtypes(modelo)
      linhas.push(`${modelo}: formatos ${tipos.length > 0 ? tipos.join(', ') : '(nenhum)'}`)
    } catch (erro) {
      linhas.push(`${modelo}: não deu para listar os formatos — ${(erro as Error).message?.slice(0, 70)}`)
      continue
    }

    for (const tipo of ['fp32', 'int8', 'q8']) {
      try {
        const arquivos = await registro.get_pipeline_files('automatic-speech-recognition', modelo, {
          device: 'wasm',
          dtype: tipo,
        })
        const onnx = arquivos.filter((a) => a.endsWith('.onnx'))
        linhas.push(`  ${tipo} → ${onnx.length > 0 ? onnx.join(', ') : arquivos.join(', ')}`)
      } catch (erro) {
        linhas.push(`  ${tipo} → falhou: ${(erro as Error).message?.slice(0, 70)}`)
      }
    }
  }
  return linhas.join('\n')
}

/** Esquece o modelo carregado, devolvendo a memória ao aparelho. */
export async function descartar(): Promise<void> {
  await reconhecedor?.dispose?.().catch(() => undefined)
  reconhecedor = null
}

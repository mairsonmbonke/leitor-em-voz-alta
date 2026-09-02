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
 * ── Por que a voz natural falhava ────────────────────────────────────────
 *
 * A biblioteca `@mintplex-labs/piper-tts-web` traz cinco defeitos que, juntos,
 * davam sempre a mesma mensagem inútil ("confira a conexão"). Todos são
 * contornados aqui:
 *
 * 1. **Versão errada do motor.** Ela manda o `onnxruntime-web` buscar o
 *    WebAssembly num CDN, no endereço da versão **1.18.0**, fixo no código —
 *    enquanto a versão instalada no projeto é outra (1.29). As duas metades não
 *    combinam e a criação da sessão falha, sempre, em qualquer aparelho. Agora
 *    esse endereço é ignorado: o `onnxruntime-web` acha sozinho o WebAssembly
 *    que o próprio build empacotou, servido pela página, na versão certa — sem
 *    CDN, sem CORS e igual em desenvolvimento e publicado. O mesmo vale para o
 *    conversor de fonemas, copiado para `public/motor/`
 *    (ver `scripts/preparar-motor.mjs`).
 * 2. **Download sem conferência.** O `fetch` dela nunca olha o `res.ok`: uma
 *    resposta 404 (uma página HTML de erro) era guardada como se fosse o modelo
 *    e só estourava depois, na hora de usar. Aqui o download é nosso, confere o
 *    código HTTP, o tamanho e o conteúdo antes de guardar.
 * 3. **Gravação sem espera.** O `download()` dizia "pronto" antes de o arquivo
 *    estar guardado, e engolia em silêncio qualquer erro de gravação (falta de
 *    espaço, por exemplo). Aqui a gravação é conferida arquivo por arquivo.
 * 4. **Safari.** A gravação dela usa `createWritable`, que falta nos Safari mais
 *    antigos. Aqui, quando ele não existe, a gravação vai por um *worker* com
 *    `createSyncAccessHandle` — o caminho que o Safari oferece.
 * 5. **Vários núcleos.** Ela liga o ONNX em várias linhas de execução, o que
 *    exige `SharedArrayBuffer` e cabeçalhos de isolamento que o GitHub Pages não
 *    envia. Aqui o número fica travado em 1.
 *
 * E mais um, da própria biblioteca: a sessão é única e não troca o modelo
 * quando o idioma muda — falaria inglês com o modelo do português. A sessão é
 * descartada na troca.
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
  { id: 'pt_BR-faber-medium', idioma: 'pt-BR', nome: 'Faber (natural, offline)', tamanhoMB: 61 },
  { id: 'en_US-hfc_female-medium', idioma: 'en-US', nome: 'HFC Female (natural, offline)', tamanhoMB: 61 },
  { id: 'es_ES-davefx-medium', idioma: 'es-ES', nome: 'DaveFX (natural, offline)', tamanhoMB: 61 },
  { id: 'de_DE-thorsten-medium', idioma: 'de-DE', nome: 'Thorsten (natural, offline)', tamanhoMB: 61 },
]

/** Onde cada modelo mora dentro do repositório de vozes. */
const CAMINHOS: Record<string, string> = {
  'pt_BR-faber-medium': 'pt/pt_BR/faber/medium/pt_BR-faber-medium.onnx',
  'en_US-hfc_female-medium': 'en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx',
  'es_ES-davefx-medium': 'es/es_ES/davefx/medium/es_ES-davefx-medium.onnx',
  'de_DE-thorsten-medium': 'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx',
}

/**
 * De onde o modelo vem. Os dois são o mesmo acervo público do Piper no Hugging
 * Face, com a mesma organização de pastas: se o primeiro estiver fora do ar ou
 * bloqueado, o segundo é tentado antes de desistir.
 */
const ENDERECOS = [
  'https://huggingface.co/rhasspy/piper-voices/resolve/main',
  'https://huggingface.co/diffusionstudio/piper-voices/resolve/main',
]

/** Um modelo de verdade não tem menos que isto. Serve para achar lixo guardado. */
const MINIMO_DO_MODELO = 5 * 1024 * 1024

/** Espaço que o navegador precisa ter livre para guardar o modelo, com folga. */
const ESPACO_NECESSARIO = 90 * 1024 * 1024

export function vozNaturalDoIdioma(idioma: string): VozNatural | null {
  return VOZES_NATURAIS.find((voz) => voz.idioma === idioma) ?? null
}

/** Andamento real do download, em bytes. `total` é 0 quando o servidor não diz. */
export interface Andamento {
  etapa: 'ajustes' | 'modelo' | 'guardando'
  baixados: number
  total: number
}

export type AoBaixar = (andamento: Andamento) => void

/**
 * Erro com mensagem pronta para mostrar na tela.
 *
 * `detalhe` guarda a explicação técnica (endereço, código HTTP, nome do erro do
 * navegador) — vai para o console e para o "ver detalhes" da tela, sem poluir a
 * mensagem principal.
 */
export class ErroDeVoz extends Error {
  detalhe: string
  /** Uma segunda tentativa tem chance de dar certo? */
  temJeito: boolean

  constructor(mensagem: string, detalhe = '', temJeito = true) {
    super(mensagem)
    this.name = 'ErroDeVoz'
    this.detalhe = detalhe
    this.temJeito = temJeito
  }
}

/**
 * Quanto esperar por uma fala antes de dar o motor por travado.
 *
 * A **primeira** fala de cada sessão é diferente das outras: nela o navegador
 * ainda baixa o conversor de fonemas e os dados de idioma (~18 MB) e carrega o
 * modelo na memória. Numa rede lenta isso sozinho passa de 45 s, e um limite
 * curto transformaria uma conexão ruim em "a voz natural falhou". Depois disso,
 * cada frase leva segundos — aí um limite curto é justamente o que evita
 * "Preparando…" para sempre.
 */
const LIMITE_DA_PRIMEIRA_FALA = 180_000
const LIMITE_DE_ESPERA = 45_000

interface Sessao {
  voiceId: string
  waitReady: Promise<void> | boolean
  predict: (texto: string) => Promise<Blob>
}

interface CaminhosDoWasm {
  onnxWasm: string
  piperData: string
  piperWasm: string
}

/** O pedaço da biblioteca que a página usa. */
interface Motor {
  TtsSession: {
    new (opcoes: { voiceId: string; wasmPaths?: CaminhosDoWasm }): Sessao
    _instance: Sessao | null
  }
  stored?: () => Promise<string[]>
}

let motor: Motor | null = null
let sessao: Sessao | null = null
let vozDaSessao = ''
/** Esta sessão já falou alguma vez? (Ver `LIMITE_DA_PRIMEIRA_FALA`.) */
let jaFalou = false

/** Troca o motor por um de mentira. Usado pelos testes de interface. */
export function definirMotor(falso: Motor | null): void {
  motor = falso
  sessao = null
  vozDaSessao = ''
  jaFalou = false
}

function deTeste(): Motor | null {
  return (globalThis as { __motorDeVozDeTeste?: Motor }).__motorDeVozDeTeste ?? null
}

/** Endereço da pasta `motor/`, servida junto com a página. */
function pastaDoMotor(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return new URL(`${base}motor/`, location.href).href
}

function caminhosDoWasm(): CaminhosDoWasm {
  const pasta = pastaDoMotor()
  return {
    // Ignorado: `wasmPaths` fica travado logo abaixo, para o `onnxruntime-web`
    // usar o arquivo que o build empacotou junto com a página.
    onnxWasm: '',
    piperData: `${pasta}piper_phonemize.data`,
    piperWasm: `${pasta}piper_phonemize.wasm`,
  }
}

async function carregarMotor(): Promise<Motor> {
  // Os testes de interface põem um motor de mentira aqui para exercitar a
  // leitura sem baixar 60 MB de modelo a cada execução.
  const falso = deTeste()
  if (falso) return falso
  if (motor) return motor

  // Antes da biblioteca: o ONNX precisa ficar numa linha de execução só, e o
  // endereço do WebAssembly precisa continuar vazio — assim o próprio
  // `onnxruntime-web` usa o arquivo que o build empacotou ao lado da página,
  // em vez do CDN de versão errada. A biblioteca sobrescreve as duas coisas ao
  // iniciar, então as propriedades são travadas.
  try {
    const ort = (await import('onnxruntime-web/wasm')) as unknown as {
      env?: { wasm?: Record<string, unknown> }
    }
    const wasm = ort.env?.wasm
    if (wasm) {
      Object.defineProperty(wasm, 'numThreads', { get: () => 1, set: () => {}, configurable: true })
      Object.defineProperty(wasm, 'wasmPaths', { get: () => undefined, set: () => {}, configurable: true })
    }
  } catch {
    // Sem o ajuste a biblioteca ainda pode funcionar onde há isolamento.
  }

  motor = (await import('@mintplex-labs/piper-tts-web')) as unknown as Motor
  return motor
}

// ── O que este navegador consegue fazer ───────────────────────────────

/** O navegador tem o necessário para rodar a voz natural? */
export function suportaVozNatural(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof WebAssembly === 'object' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function'
  )
}

// ── Guardar e ler no armazenamento do navegador (OPFS) ────────────────

async function pastaPiper(): Promise<FileSystemDirectoryHandle> {
  const raiz = await navigator.storage.getDirectory()
  return raiz.getDirectoryHandle('piper', { create: true })
}

/**
 * Grava um arquivo na pasta do Piper.
 *
 * Dois caminhos: o comum (`createWritable`) e o do Safari, que só oferece a
 * gravação síncrona e apenas dentro de um *worker*.
 */
async function guardarArquivo(nome: string, dados: ArrayBuffer): Promise<void> {
  const pasta = await pastaPiper()
  const arquivo = await pasta.getFileHandle(nome, { create: true })

  const comEscrita = arquivo as FileSystemFileHandle & {
    createWritable?: () => Promise<{ write: (d: ArrayBuffer) => Promise<void>; close: () => Promise<void> }>
  }
  if (typeof comEscrita.createWritable === 'function') {
    const escrita = await comEscrita.createWritable()
    await escrita.write(dados)
    await escrita.close()
    return
  }

  await guardarPorWorker(nome, dados)
}

/** Fonte do worker de gravação — pequeno o bastante para morar aqui. */
const FONTE_DO_WORKER = `
self.onmessage = async (evento) => {
  const { nome, dados } = evento.data
  try {
    const raiz = await navigator.storage.getDirectory()
    const pasta = await raiz.getDirectoryHandle('piper', { create: true })
    const arquivo = await pasta.getFileHandle(nome, { create: true })
    const alca = await arquivo.createSyncAccessHandle()
    alca.truncate(0)
    alca.write(new Uint8Array(dados), { at: 0 })
    alca.flush()
    alca.close()
    self.postMessage({ ok: true })
  } catch (erro) {
    self.postMessage({ ok: false, erro: String((erro && erro.message) || erro) })
  }
}
`

function guardarPorWorker(nome: string, dados: ArrayBuffer): Promise<void> {
  return new Promise((pronto, falhou) => {
    let endereco = ''
    let worker: Worker
    try {
      endereco = URL.createObjectURL(new Blob([FONTE_DO_WORKER], { type: 'text/javascript' }))
      worker = new Worker(endereco)
    } catch (erro) {
      falhou(
        new ErroDeVoz(
          'Este navegador não deixa a página guardar o modelo da voz natural.',
          `Worker indisponível: ${String(erro)}`,
          false,
        ),
      )
      return
    }
    worker.onmessage = (evento: MessageEvent<{ ok: boolean; erro?: string }>) => {
      worker.terminate()
      URL.revokeObjectURL(endereco)
      if (evento.data.ok) pronto()
      else falhou(new ErroDeVoz(mensagemDeGravacao(evento.data.erro ?? ''), evento.data.erro ?? ''))
    }
    worker.onerror = (evento) => {
      worker.terminate()
      URL.revokeObjectURL(endereco)
      falhou(new ErroDeVoz('Falha ao guardar o modelo da voz natural.', evento.message))
    }
    worker.postMessage({ nome, dados }, [dados])
  })
}

function mensagemDeGravacao(texto: string): string {
  if (/quota|space|storage/i.test(texto)) {
    return 'Não há espaço livre suficiente no navegador para guardar a voz natural (são cerca de 60 MB).'
  }
  return 'O navegador não conseguiu guardar o modelo da voz natural.'
}

/** Tamanho de um arquivo já guardado; 0 quando ele não existe. */
async function tamanhoGuardado(nome: string): Promise<number> {
  try {
    const pasta = await pastaPiper()
    const arquivo = await pasta.getFileHandle(nome)
    return (await arquivo.getFile()).size
  } catch {
    return 0
  }
}

async function apagarGuardado(nome: string): Promise<void> {
  try {
    const pasta = await pastaPiper()
    await pasta.removeEntry(nome)
  } catch {
    /* já não existia */
  }
}

const nomeDoModelo = (id: string) => `${id}.onnx`
const nomeDaConfiguracao = (id: string) => `${id}.onnx.json`

/**
 * Modelos guardados **e íntegros** neste navegador.
 *
 * Conferir o tamanho não é zelo excessivo: a versão anterior da página chegava
 * a guardar uma página de erro HTML com nome de modelo. Um arquivo assim é
 * apagado aqui, para que o download seja refeito em vez de falhar de novo.
 */
export async function jaBaixadas(): Promise<string[]> {
  const falso = deTeste()
  if (falso?.stored) return falso.stored()
  if (!suportaVozNatural()) return []

  const prontas: string[] = []
  for (const voz of VOZES_NATURAIS) {
    const modelo = await tamanhoGuardado(nomeDoModelo(voz.id))
    const configuracao = await tamanhoGuardado(nomeDaConfiguracao(voz.id))
    if (modelo >= MINIMO_DO_MODELO && configuracao > 0) {
      prontas.push(voz.id)
    } else if (modelo > 0 || configuracao > 0) {
      // Sobra de um download que deu errado: sai da frente.
      await apagarGuardado(nomeDoModelo(voz.id))
      await apagarGuardado(nomeDaConfiguracao(voz.id))
    }
  }
  return prontas
}

// ── Download ──────────────────────────────────────────────────────────

/** Traduz uma falha de rede em uma frase que diz o que realmente aconteceu. */
function erroDeRede(endereco: string, erro: unknown): ErroDeVoz {
  const texto = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro)
  const servidor = new URL(endereco).host

  if (/abort/i.test(texto)) return new ErroDeVoz('Download cancelado.', texto)
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return new ErroDeVoz('O aparelho está sem internet no momento.', texto)
  }
  return new ErroDeVoz(
    `O navegador não conseguiu falar com ${servidor}. A internet pode estar funcionando e mesmo assim ` +
      'esse endereço estar bloqueado — é comum em redes de empresa, escola, VPN ou antivírus.',
    `${texto} — ${endereco}`,
  )
}

/** Baixa um arquivo, conferindo tudo o que a biblioteca não conferia. */
async function baixarArquivo(
  endereco: string,
  aoAndar?: (baixados: number, total: number) => void,
  sinal?: AbortSignal,
): Promise<ArrayBuffer> {
  let resposta: Response
  try {
    resposta = await fetch(endereco, { signal: sinal, redirect: 'follow' })
  } catch (erro) {
    throw erroDeRede(endereco, erro)
  }

  if (!resposta.ok) {
    const servidor = new URL(endereco).host
    const detalhe = `HTTP ${resposta.status} ${resposta.statusText} — ${endereco}`
    if (resposta.status === 404) {
      throw new ErroDeVoz(`O arquivo da voz não está mais neste endereço de ${servidor} (erro 404).`, detalhe)
    }
    if (resposta.status === 401 || resposta.status === 403) {
      throw new ErroDeVoz(`${servidor} recusou o download (erro ${resposta.status}).`, detalhe)
    }
    if (resposta.status === 429) {
      throw new ErroDeVoz(`${servidor} pediu para esperar um pouco (erro 429). Tente de novo em alguns minutos.`, detalhe)
    }
    throw new ErroDeVoz(`${servidor} respondeu com o erro ${resposta.status} em vez do arquivo da voz.`, detalhe)
  }

  const total = Number(resposta.headers.get('Content-Length') ?? 0)
  const leitor = resposta.body?.getReader()

  // Sem acesso ao corpo em pedaços não há andamento, mas o download funciona.
  if (!leitor) {
    const dados = await resposta.arrayBuffer()
    aoAndar?.(dados.byteLength, dados.byteLength)
    return dados
  }

  const pedacos: Uint8Array[] = []
  let baixados = 0
  for (;;) {
    let passo: ReadableStreamReadResult<Uint8Array>
    try {
      passo = await leitor.read()
    } catch (erro) {
      // Uma conexão que cai no meio de 60 MB cai aqui, não no `fetch`.
      throw new ErroDeVoz(
        `O download da voz parou em ${(baixados / 1024 / 1024).toFixed(1)} MB. A conexão foi interrompida — ` +
          'dá para tentar de novo.',
        `${String(erro)} — ${endereco}`,
      )
    }
    if (passo.done) break
    pedacos.push(passo.value)
    baixados += passo.value.length
    aoAndar?.(baixados, total)
  }

  if (total > 0 && baixados < total) {
    throw new ErroDeVoz(
      `O download veio incompleto (${(baixados / 1024 / 1024).toFixed(1)} MB de ` +
        `${(total / 1024 / 1024).toFixed(1)} MB). Tente de novo.`,
      `incompleto — ${endereco}`,
    )
  }

  const dados = new Uint8Array(baixados)
  let posicao = 0
  for (const pedaco of pedacos) {
    dados.set(pedaco, posicao)
    posicao += pedaco.length
  }
  return dados.buffer
}

/** Isto que chegou é mesmo um modelo, ou é uma página de erro disfarçada? */
function conferirModelo(dados: ArrayBuffer, endereco: string): void {
  if (dados.byteLength < MINIMO_DO_MODELO) {
    const inicio = new TextDecoder().decode(new Uint8Array(dados, 0, Math.min(80, dados.byteLength)))
    const pagina = /^\s*[<{]/.test(inicio)
    throw new ErroDeVoz(
      pagina
        ? 'O servidor devolveu uma página de erro no lugar do arquivo da voz.'
        : `O arquivo da voz chegou pequeno demais (${(dados.byteLength / 1024).toFixed(0)} kB).`,
      `${dados.byteLength} bytes — ${endereco} — início: ${inicio.slice(0, 60)}`,
    )
  }
}

/** A configuração é um JSON com os campos que a síntese usa. */
function conferirConfiguracao(dados: ArrayBuffer, endereco: string): void {
  let lido: unknown
  try {
    lido = JSON.parse(new TextDecoder().decode(dados))
  } catch (erro) {
    throw new ErroDeVoz(
      'Os ajustes da voz vieram num formato que o programa não entende.',
      `${String(erro)} — ${endereco}`,
    )
  }
  const conteudo = lido as { audio?: { sample_rate?: number }; espeak?: { voice?: string } }
  if (!conteudo?.audio?.sample_rate || !conteudo?.espeak?.voice) {
    throw new ErroDeVoz('Os ajustes da voz vieram incompletos.', `campos ausentes — ${endereco}`)
  }
}

/** Há espaço no navegador para os 60 MB? */
async function conferirEspaco(): Promise<void> {
  try {
    const { quota = 0, usage = 0 } = (await navigator.storage.estimate?.()) ?? {}
    if (quota > 0 && quota - usage < ESPACO_NECESSARIO) {
      throw new ErroDeVoz(
        `Falta espaço no navegador para a voz natural: sobram ` +
          `${((quota - usage) / 1024 / 1024).toFixed(0)} MB e são necessários cerca de 90 MB. ` +
          'Libere espaço no aparelho e tente de novo.',
        `quota=${quota} usage=${usage}`,
      )
    }
  } catch (erro) {
    if (erro instanceof ErroDeVoz) throw erro
    // Navegador que não sabe estimar: segue e deixa o erro real aparecer.
  }
}

/**
 * Baixa o modelo desta voz e guarda no navegador.
 *
 * Todo o caminho é nosso: buscar, conferir, guardar e conferir de novo. Assim
 * qualquer tropeço tem nome — e a segunda tentativa começa do zero, limpa.
 */
export async function baixar(id: string, aoBaixar?: AoBaixar, sinal?: AbortSignal): Promise<void> {
  const falso = deTeste()
  if (falso) {
    // Nos testes de interface o download é instantâneo.
    aoBaixar?.({ etapa: 'ajustes', baixados: 0, total: 0 })
    const comDownload = falso as unknown as {
      download?: (id: string, p: (d: { loaded: number; total: number }) => void) => Promise<void>
    }
    await comDownload.download?.(id, ({ loaded, total }) =>
      aoBaixar?.({ etapa: 'modelo', baixados: loaded, total }),
    )
    aoBaixar?.({ etapa: 'modelo', baixados: 1, total: 1 })
    return
  }

  const caminho = CAMINHOS[id]
  if (!caminho) throw new ErroDeVoz('Esta voz não está no catálogo.', id, false)
  if (!suportaVozNatural()) {
    throw new ErroDeVoz('Este navegador não tem o que a voz natural precisa para funcionar.', 'sem OPFS/WebAssembly', false)
  }

  await conferirEspaco()

  // Restos de uma tentativa anterior atrapalhariam a conferência final.
  await apagarGuardado(nomeDoModelo(id))
  await apagarGuardado(nomeDaConfiguracao(id))

  let ultimo: ErroDeVoz | null = null
  for (const raiz of ENDERECOS) {
    try {
      aoBaixar?.({ etapa: 'ajustes', baixados: 0, total: 0 })
      const configuracao = await baixarArquivo(`${raiz}/${caminho}.json`, undefined, sinal)
      conferirConfiguracao(configuracao, `${raiz}/${caminho}.json`)

      const modelo = await baixarArquivo(
        `${raiz}/${caminho}`,
        (baixados, total) => aoBaixar?.({ etapa: 'modelo', baixados, total }),
        sinal,
      )
      conferirModelo(modelo, `${raiz}/${caminho}`)

      aoBaixar?.({ etapa: 'guardando', baixados: modelo.byteLength, total: modelo.byteLength })
      await guardarArquivo(nomeDaConfiguracao(id), configuracao)
      await guardarArquivo(nomeDoModelo(id), modelo)

      // A biblioteca lê o que está guardado; se a gravação não valeu, é aqui
      // que se descobre — não na hora de falar.
      const gravado = await tamanhoGuardado(nomeDoModelo(id))
      if (gravado < MINIMO_DO_MODELO) {
        throw new ErroDeVoz(
          'O modelo foi baixado, mas o navegador não conseguiu guardá-lo.',
          `guardado com ${gravado} bytes`,
        )
      }
      return
    } catch (erro) {
      ultimo = erro instanceof ErroDeVoz ? erro : new ErroDeVoz('Falha ao baixar a voz natural.', String(erro))
      await apagarGuardado(nomeDoModelo(id))
      await apagarGuardado(nomeDaConfiguracao(id))
      // Erro sem jeito (cancelamento, navegador incapaz) não melhora no espelho.
      if (!ultimo.temJeito || sinal?.aborted) throw ultimo
    }
  }
  throw ultimo ?? new ErroDeVoz('Não foi possível baixar a voz natural.', '')
}

// ── Síntese ───────────────────────────────────────────────────────────

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
    sessao = new lib.TtsSession({ voiceId: id, wasmPaths: caminhosDoWasm() })
    vozDaSessao = id
    jaFalou = false
    try {
      await sessao.waitReady
    } catch (erro) {
      sessao = null
      lib.TtsSession._instance = null
      throw comoErroDeVoz(erro)
    }
  }
  return sessao
}

/** Transforma a falha da biblioteca numa frase que ajuda quem está lendo. */
function comoErroDeVoz(erro: unknown): ErroDeVoz {
  if (erro instanceof ErroDeVoz) return erro
  const texto = erro instanceof Error ? `${erro.name}: ${erro.message}` : String(erro)

  if (/SharedArrayBuffer|cross-origin|isolat/i.test(texto)) {
    return new ErroDeVoz('Este navegador não deixa a voz natural usar vários núcleos nesta página.', texto)
  }
  if (/out of memory|memory access|allocat|OOM|RangeError/i.test(texto)) {
    return new ErroDeVoz(
      'O aparelho ficou sem memória para a voz natural. Feche outras abas e tente de novo — ' +
        'em aparelhos mais antigos ela pode simplesmente não caber.',
      texto,
    )
  }
  if (/wasm|WebAssembly|magic word|compile/i.test(texto)) {
    return new ErroDeVoz(
      'O motor da voz natural não pôde ser carregado neste navegador.',
      `${texto} — fonemas em ${pastaDoMotor()}`,
    )
  }
  if (/no available backend|backend not found|InferenceSession/i.test(texto)) {
    return new ErroDeVoz('O motor da voz natural não conseguiu abrir o modelo guardado.', texto)
  }
  if (/fetch|network|Failed to fetch/i.test(texto)) {
    return new ErroDeVoz('Faltou baixar uma peça da voz natural.', texto)
  }
  return new ErroDeVoz('A voz natural falhou neste aparelho.', texto)
}

/** Gera o áudio de um trecho de texto. */
export async function sintetizar(id: string, texto: string): Promise<Blob> {
  const atual = await pegarSessao(id)

  // Se a fala travar (a biblioteca tem um caminho em que a promessa nunca se
  // resolve), é melhor um erro claro do que "Preparando…" para sempre.
  const espera = jaFalou ? LIMITE_DE_ESPERA : LIMITE_DA_PRIMEIRA_FALA
  let relogio = 0
  const limite = new Promise<never>((_, falhar) => {
    relogio = window.setTimeout(
      () =>
        falhar(
          new ErroDeVoz(
            jaFalou
              ? 'A voz natural demorou demais para responder neste aparelho.'
              : 'A voz natural não terminou de carregar a tempo. Numa rede lenta vale tentar de novo — ' +
                'o que já veio fica guardado.',
            `tempo esgotado (${espera / 1000}s, ${jaFalou ? 'fala comum' : 'primeira fala'})`,
          ),
        ),
      espera,
    )
  })

  try {
    const audio = await Promise.race([atual.predict(texto), limite])
    jaFalou = true
    return audio
  } catch (erro) {
    // Uma sessão que falhou não costuma se recuperar sozinha.
    sessao = null
    jaFalou = false
    throw comoErroDeVoz(erro)
  } finally {
    window.clearTimeout(relogio)
  }
}

/** Apaga o modelo baixado, devolvendo o espaço ao aparelho. */
export async function apagar(id: string): Promise<void> {
  const falso = deTeste() as unknown as { remove?: (id: string) => Promise<void> } | null
  if (falso?.remove) {
    await falso.remove(id)
    return
  }
  if (vozDaSessao === id) {
    sessao = null
    if (motor) motor.TtsSession._instance = null
    vozDaSessao = ''
  }
  await apagarGuardado(nomeDoModelo(id))
  await apagarGuardado(nomeDaConfiguracao(id))
}

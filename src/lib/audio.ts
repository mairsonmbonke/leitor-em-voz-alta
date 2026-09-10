/**
 * Preparar um arquivo de áudio para a transcrição.
 *
 * O modelo de reconhecimento só entende um formato: som cru, um canal só, a
 * 16 000 amostras por segundo. Qualquer arquivo — um áudio do WhatsApp, uma
 * gravação do celular, um vídeo — precisa virar isso antes.
 *
 * O caminho normal é o próprio navegador decodificar (`decodeAudioData`), o que
 * cobre MP3, M4A, WAV, AAC e, na maioria dos navegadores, também Opus. O
 * problema mora justamente aí: **o áudio do WhatsApp é Opus dentro de um
 * arquivo `.ogg`**, e nem todo Safari sabe abrir isso. Quando o navegador
 * recusa, entra um decodificador de Opus em WebAssembly, que roda aqui mesmo —
 * sem servidor, sem chave, sem cadastro.
 */

export class ErroDeAudio extends Error {}

/** O que o modelo de reconhecimento espera. */
export const TAXA_DO_MODELO = 16_000

/** Extensões de áudio (e de vídeo com áudio) que a página aceita. */
const EXTENSOES = [
  'opus', 'ogg', 'oga', 'mp3', 'm4a', 'aac', 'wav', 'wave', 'weba', 'webm',
  'caf', 'amr', '3gp', '3gpp', 'mp4', 'mov', 'flac', 'aiff', 'aif',
]

/** O arquivo é um áudio (ou um vídeo, de onde só o som interessa)? */
export function ehAudio(nome: string, tipo: string): boolean {
  if (tipo.startsWith('audio/')) return true
  if (tipo.startsWith('video/')) return true
  const extensao = nome.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSOES.includes(extensao)
}

/** Um áudio do WhatsApp: Opus dentro de um contêiner Ogg. */
function pareceOggOpus(dados: ArrayBuffer, nome: string, tipo: string): boolean {
  if (/ogg|opus/i.test(tipo)) return true
  if (/\.(ogg|oga|opus)$/i.test(nome)) return true
  // "OggS" — a assinatura do contêiner, para quando nome e tipo não ajudam.
  const inicio = new Uint8Array(dados, 0, Math.min(4, dados.byteLength))
  return inicio[0] === 0x4f && inicio[1] === 0x67 && inicio[2] === 0x67 && inicio[3] === 0x53
}

/** Mistura os canais num só e reamostra para a taxa do modelo. */
async function paraUmCanalA16k(canais: Float32Array[], taxaOriginal: number): Promise<Float32Array> {
  const quadros = canais[0]?.length ?? 0
  if (quadros === 0) throw new ErroDeAudio('Este arquivo de áudio está vazio.')

  // Já está do jeito certo: nada a fazer.
  if (taxaOriginal === TAXA_DO_MODELO && canais.length === 1) return canais[0]

  const duracao = quadros / taxaOriginal
  const destino = Math.max(1, Math.round(duracao * TAXA_DO_MODELO))

  const Offline = (globalThis as { OfflineAudioContext?: typeof OfflineAudioContext }).OfflineAudioContext
  if (!Offline) {
    // Sem o contexto de áudio, a reamostragem vai na mão: pega a amostra mais
    // próxima. Perde um pouco de qualidade, mas a fala continua legível.
    const saida = new Float32Array(destino)
    for (let i = 0; i < destino; i += 1) {
      const origem = Math.min(quadros - 1, Math.round((i * taxaOriginal) / TAXA_DO_MODELO))
      let soma = 0
      for (const canal of canais) soma += canal[origem]
      saida[i] = soma / canais.length
    }
    return saida
  }

  const contexto = new Offline(1, destino, TAXA_DO_MODELO)
  const fonte = contexto.createBuffer(canais.length, quadros, taxaOriginal)
  for (let c = 0; c < canais.length; c += 1) fonte.copyToChannel(canais[c] as Float32Array<ArrayBuffer>, c)
  const no = contexto.createBufferSource()
  no.buffer = fonte
  no.connect(contexto.destination)
  no.start()
  const pronto = await contexto.startRendering()
  return pronto.getChannelData(0)
}

/** O decodificador de Opus, carregado só quando o navegador não dá conta. */
async function decodificarOpus(dados: ArrayBuffer): Promise<{ canais: Float32Array[]; taxa: number }> {
  const { OggOpusDecoder } = (await import('ogg-opus-decoder')) as unknown as {
    OggOpusDecoder: new () => {
      ready: Promise<void>
      decodeFile: (d: Uint8Array) => Promise<{ channelData: Float32Array[]; sampleRate: number }>
      free: () => void
    }
  }
  const decodificador = new OggOpusDecoder()
  await decodificador.ready
  try {
    const saida = await decodificador.decodeFile(new Uint8Array(dados))
    if (!saida.channelData?.[0]?.length) throw new ErroDeAudio('Não há som neste arquivo.')
    return { canais: saida.channelData, taxa: saida.sampleRate }
  } finally {
    decodificador.free()
  }
}

/**
 * Lê o arquivo e devolve o som pronto para o reconhecimento, junto com a
 * duração em segundos (que serve para estimar quanto vai demorar).
 */
export async function prepararAudio(arquivo: Blob, nome = ''): Promise<{ amostras: Float32Array; segundos: number }> {
  const dados = await arquivo.arrayBuffer()
  if (dados.byteLength === 0) throw new ErroDeAudio('Este arquivo de áudio está vazio.')

  const Contexto =
    (globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ??
    (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext

  let canais: Float32Array[] | null = null
  let taxa = TAXA_DO_MODELO

  if (Contexto) {
    const contexto = new Contexto()
    try {
      // `decodeAudioData` consome o buffer; a cópia guarda o original para o
      // decodificador de Opus, caso o navegador recuse o arquivo.
      const buffer = await contexto.decodeAudioData(dados.slice(0))
      canais = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c))
      taxa = buffer.sampleRate
    } catch {
      canais = null
    } finally {
      void contexto.close?.()
    }
  }

  // O navegador recusou. Se for o Opus do WhatsApp, ainda dá para abrir aqui.
  if (!canais && pareceOggOpus(dados, nome, arquivo.type)) {
    try {
      const saida = await decodificarOpus(dados)
      canais = saida.canais
      taxa = saida.taxa
    } catch (erro) {
      throw erro instanceof ErroDeAudio
        ? erro
        : new ErroDeAudio('Este áudio está num formato que o programa não conseguiu abrir.')
    }
  }

  if (!canais) {
    throw new ErroDeAudio(
      'Este navegador não conseguiu abrir o áudio. Converta para MP3 ou M4A e tente de novo.',
    )
  }

  const amostras = await paraUmCanalA16k(canais, taxa)
  return { amostras, segundos: amostras.length / TAXA_DO_MODELO }
}

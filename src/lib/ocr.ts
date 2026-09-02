/**
 * Reconhecimento do texto que aparece dentro de imagens (OCR).
 *
 * Serve para uma foto de página, um recibo, um cartaz — e para PDFs
 * digitalizados, que são imagens de páginas sem texto por baixo. O objetivo é
 * só ler as palavras que estão ali; não descreve a fotografia.
 *
 * Roda no próprio navegador com o Tesseract, sem servidor, sem cadastro e sem
 * chave. Os dados de cada idioma (alguns megabytes) são baixados na primeira
 * vez que aquele idioma é usado e ficam no cache do navegador.
 */

/** Códigos do Tesseract para os idiomas que a página oferece. */
const IDIOMAS_OCR: Record<string, string> = {
  'pt-BR': 'por',
  'en-US': 'eng',
  'es-ES': 'spa',
  'de-DE': 'deu',
}

export function idiomaDoOcr(idioma: string): string {
  return IDIOMAS_OCR[idioma] ?? 'eng'
}

export interface ProgressoOcr {
  /** De 0 a 1. */
  fracao: number
  /** O que está acontecendo, em português. */
  etapa: string
}

export type AoProgredir = (progresso: ProgressoOcr) => void

/** Erro com mensagem pronta para mostrar na tela. */
export class ErroDeOcr extends Error {}

/** O pedaço do Tesseract que a página usa. */
interface Reconhecedor {
  recognize: (imagem: Blob) => Promise<{ data: { text: string } }>
  terminate: () => Promise<unknown>
}

interface MotorOcr {
  createWorker: (
    idioma: string,
    oem?: number,
    opcoes?: { logger?: (m: { status: string; progress: number }) => void },
  ) => Promise<Reconhecedor>
}

async function carregarMotor(): Promise<MotorOcr> {
  // Os testes de interface põem um motor de mentira aqui, para não baixar os
  // dados de idioma a cada execução.
  const deTeste = (globalThis as { __motorDeOcrDeTeste?: MotorOcr }).__motorDeOcrDeTeste
  if (deTeste) return deTeste
  return (await import('tesseract.js')) as unknown as MotorOcr
}

/** Traduz os avisos do Tesseract para algo legível. */
function etapaEmPortugues(status: string): string {
  if (status.includes('loading language') || status.includes('loading tesseract')) return 'Preparando o idioma…'
  if (status.includes('initializ')) return 'Preparando o reconhecimento…'
  if (status.includes('recognizing')) return 'Lendo o texto da imagem…'
  return 'Processando…'
}

/**
 * Lê o texto de uma imagem.
 *
 * `sinal` permite cancelar: ao ser abortado, o trabalhador é encerrado e a
 * promessa é recusada com `ErroDeOcr`.
 */
export async function reconhecerImagem(
  imagem: Blob,
  idioma: string,
  aoProgredir?: AoProgredir,
  sinal?: AbortSignal,
): Promise<string> {
  if (sinal?.aborted) throw new ErroDeOcr('Reconhecimento cancelado.')

  const motor = await carregarMotor()
  let trabalhador: Reconhecedor | null = null

  try {
    trabalhador = await motor.createWorker(idiomaDoOcr(idioma), 1, {
      logger: ({ status, progress }) =>
        aoProgredir?.({ fracao: Math.min(1, Math.max(0, progress)), etapa: etapaEmPortugues(status) }),
    })
  } catch {
    throw new ErroDeOcr('Não foi possível preparar o reconhecimento de texto. Confira a conexão e tente de novo.')
  }

  const encerrar = () => void trabalhador?.terminate().catch(() => undefined)
  sinal?.addEventListener('abort', encerrar, { once: true })

  // Encerrar o trabalhador mata o Web Worker por baixo, e o `recognize()` que
  // estava a caminho pode simplesmente nunca responder. Sem esta corrida, o
  // cancelamento deixaria uma promessa pendurada para sempre.
  let cancelamento: () => void = () => {}
  const cancelado = new Promise<never>((_, falhar) => {
    cancelamento = () => falhar(new ErroDeOcr('Reconhecimento cancelado.'))
    if (sinal?.aborted) cancelamento()
    else sinal?.addEventListener('abort', cancelamento, { once: true })
  })
  // Uma promessa recusada que ninguém observa vira aviso no console.
  cancelado.catch(() => undefined)

  try {
    const resultado = await Promise.race([trabalhador.recognize(imagem), cancelado])
    if (sinal?.aborted) throw new ErroDeOcr('Reconhecimento cancelado.')
    return limpar(resultado.data.text)
  } catch (erro) {
    if (sinal?.aborted) throw new ErroDeOcr('Reconhecimento cancelado.')
    throw erro instanceof ErroDeOcr ? erro : new ErroDeOcr('O reconhecimento de texto falhou nesta imagem.')
  } finally {
    sinal?.removeEventListener('abort', encerrar)
    sinal?.removeEventListener('abort', cancelamento)
    await trabalhador.terminate().catch(() => undefined)
  }
}

/**
 * Lê o texto de várias imagens (as páginas de um PDF digitalizado), avisando o
 * andamento página a página.
 */
export async function reconhecerPaginas(
  paginas: Blob[],
  idioma: string,
  aoProgredir?: AoProgredir,
  sinal?: AbortSignal,
): Promise<string> {
  const partes: string[] = []

  for (let i = 0; i < paginas.length; i += 1) {
    if (sinal?.aborted) throw new ErroDeOcr('Reconhecimento cancelado.')
    const texto = await reconhecerImagem(
      paginas[i],
      idioma,
      ({ fracao }) =>
        aoProgredir?.({
          fracao: (i + fracao) / paginas.length,
          etapa: `Lendo a página ${i + 1} de ${paginas.length}…`,
        }),
      sinal,
    )
    if (texto.trim().length > 0) partes.push(texto)
  }

  return partes.join('\n\n')
}

/**
 * Arruma o texto que sai do OCR: ele vem com uma quebra de linha por linha da
 * imagem, e um parágrafo partido em seis linhas atrapalharia a leitura.
 */
function limpar(texto: string): string {
  return texto
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((linha) => linha.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** O arquivo é uma imagem que dá para reconhecer? */
export function ehImagem(nome: string, tipo: string): boolean {
  if (tipo.startsWith('image/')) return true
  return /\.(jpe?g|png|gif|bmp|webp|tiff?|heic|heif)$/i.test(nome)
}

/** Formatos que o navegador não decodifica sozinho (iPhone). */
export function ehHeic(nome: string, tipo: string): boolean {
  return /heic|heif/i.test(tipo) || /\.(heic|heif)$/i.test(nome)
}

/**
 * Leitura do texto de um arquivo anexado, dentro do próprio navegador.
 *
 * Formatos aceitos: PDF, Word (.docx), OpenDocument (.odt) e texto puro
 * (.txt, .md, .csv). Nada é enviado para servidor — o arquivo é aberto na
 * máquina de quem está usando a página.
 *
 * As bibliotecas de PDF e de descompactação entram por `import()` dinâmico,
 * então só são baixadas quando alguém realmente abre um arquivo desses.
 */

export interface ArquivoLido {
  nome: string
  texto: string
  /** Número de páginas, quando o formato tem essa informação. */
  paginas?: number
}

/** O que o seletor de arquivos oferece. */
export const TIPOS_ACEITOS = [
  '.txt',
  '.text',
  '.md',
  '.markdown',
  '.csv',
  '.pdf',
  '.docx',
  '.odt',
  'text/plain',
  'text/markdown',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
].join(',')

/** Arquivos maiores que isto travariam a página. */
const TAMANHO_MAXIMO = 30 * 1024 * 1024

/** Erro com mensagem pronta para mostrar na tela. */
export class ErroDeArquivo extends Error {}

export function extensao(nome: string): string {
  const ponto = nome.lastIndexOf('.')
  return ponto > 0 ? nome.slice(ponto + 1).toLowerCase() : ''
}

// ── Texto vindo de XML ────────────────────────────────────────────────

const ENTIDADES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
}

function decodificar(texto: string): string {
  return texto.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (inteiro, corpo: string) => {
    if (corpo[0] === '#') {
      const codigo = corpo[1] === 'x' || corpo[1] === 'X' ? parseInt(corpo.slice(2), 16) : parseInt(corpo.slice(1), 10)
      return Number.isFinite(codigo) ? String.fromCodePoint(codigo) : inteiro
    }
    return ENTIDADES[corpo] ?? inteiro
  })
}

/**
 * Texto de um `word/document.xml` de arquivo .docx.
 *
 * Cada `<w:p>` é um parágrafo e cada `<w:t>` um pedaço de texto; tabulações e
 * quebras de linha têm marcas próprias. O que estiver fora dessas marcas
 * (formatação, revisões, campos) é ignorado.
 */
export function textoDoDocx(xml: string): string {
  const paragrafos: string[] = []

  for (const trecho of xml.matchAll(/<w:p[ >][\s\S]*?<\/w:p>|<w:p\/>/g)) {
    let linha = ''
    for (const marca of trecho[0].matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:(tab|br|cr)\b[^>]*\/?>/g)) {
      if (marca[1] !== undefined) linha += decodificar(marca[1])
      else if (marca[2] === 'tab') linha += '\t'
      else linha += '\n'
    }
    paragrafos.push(linha.trim())
  }

  return limparParagrafos(paragrafos)
}

/** Texto de um `content.xml` de arquivo .odt (parágrafos e títulos). */
export function textoDoOdt(xml: string): string {
  const paragrafos: string[] = []

  for (const trecho of xml.matchAll(/<text:(p|h)(?:\s[^>]*)?>([\s\S]*?)<\/text:\1>|<text:(?:p|h)[^>]*\/>/g)) {
    const corpo = trecho[2] ?? ''
    const semMarcas = corpo
      .replace(/<text:tab[^>]*\/?>/g, '\t')
      .replace(/<text:line-break[^>]*\/?>/g, '\n')
      .replace(/<text:s\b[^>]*\/?>/g, ' ')
      .replace(/<[^>]+>/g, '')
    paragrafos.push(decodificar(semMarcas).trim())
  }

  return limparParagrafos(paragrafos)
}

/** Junta os parágrafos deixando no máximo uma linha em branco entre eles. */
function limparParagrafos(paragrafos: string[]): string {
  const linhas: string[] = []
  for (const paragrafo of paragrafos) {
    if (paragrafo.length === 0) {
      if (linhas.length > 0 && linhas[linhas.length - 1] !== '') linhas.push('')
      continue
    }
    linhas.push(...paragrafo.split('\n'))
  }
  while (linhas.length > 0 && linhas[linhas.length - 1] === '') linhas.pop()
  return linhas.join('\n')
}

// ── Linhas de PDF viram parágrafos ────────────────────────────────────

/** Marcadores que sempre começam um item novo. */
const MARCADOR = /^\s*([•·▪–—-]\s|\(?\d{1,3}[.)]\s|[a-zA-Z][.)]\s)/

/**
 * Remonta os parágrafos de um PDF.
 *
 * O PDF guarda linhas, não parágrafos: uma frase quebrada em três linhas
 * viraria três parágrafos. A pista é a largura — linhas de dentro de um
 * parágrafo vão quase até a margem, e a última linha termina antes. Linhas
 * curtas isoladas (títulos, itens de lista) continuam separadas.
 */
export function juntarLinhas(texto: string): string {
  const linhas = texto
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((linha) => linha.replace(/\s+/g, ' ').trim())

  const larguras = linhas.filter((linha) => linha.length > 0).map((linha) => linha.length)
  if (larguras.length === 0) return ''
  larguras.sort((a, b) => a - b)
  // A largura típica da coluna: o 90º percentil ignora uma linha esticada solta.
  const tipica = larguras[Math.floor(larguras.length * 0.9)]
  const cheia = tipica * 0.8

  const paragrafos: string[] = []
  let atual = ''
  /** A linha anterior terminou no meio de uma palavra. */
  let emendar = false

  const fechar = () => {
    if (atual.trim().length > 0) paragrafos.push(atual.trim())
    atual = ''
    emendar = false
  }

  const acrescentar = (pedaco: string) => {
    atual += atual.length === 0 || emendar ? pedaco : ` ${pedaco}`
    emendar = false
  }

  for (let i = 0; i < linhas.length; i += 1) {
    const linha = linhas[i]
    if (linha.length === 0) {
      fechar()
      continue
    }

    const seguinte = linhas[i + 1] ?? ''
    // Palavra cortada no fim da linha ("conti-\nnua") volta a ser uma só.
    if (/\p{L}-$/u.test(linha) && /^\p{Ll}/u.test(seguinte)) {
      acrescentar(linha.slice(0, -1))
      emendar = true
      continue
    }

    acrescentar(linha)

    const continua = linha.length >= cheia && seguinte.length > 0 && !MARCADOR.test(seguinte) && !linha.endsWith(':')
    if (!continua) fechar()
  }

  fechar()
  return paragrafos.join('\n\n')
}

// ── Leitura dos arquivos ──────────────────────────────────────────────

async function lerZip(arquivo: File, caminho: string): Promise<string> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const conteudo = new Uint8Array(await arquivo.arrayBuffer())
  const itens = unzipSync(conteudo, { filter: (item) => item.name === caminho })
  const alvo = itens[caminho]
  if (!alvo) throw new ErroDeArquivo('O arquivo está incompleto ou não é um documento válido.')
  return strFromU8(alvo)
}

async function lerPdf(arquivo: File): Promise<ArquivoLido> {
  const pdfjs = await import('pdfjs-dist')
  const { default: Trabalhador } = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker')
  if (!pdfjs.GlobalWorkerOptions.workerPort) pdfjs.GlobalWorkerOptions.workerPort = new Trabalhador()

  const dados = new Uint8Array(await arquivo.arrayBuffer())
  const tarefa = pdfjs.getDocument({ data: dados })
  const documento = await tarefa.promise
  const paginas = documento.numPages
  const partes: string[] = []

  try {
    for (let numero = 1; numero <= paginas; numero += 1) {
      const pagina = await documento.getPage(numero)
      const conteudo = await pagina.getTextContent()
      const linhas: string[] = []
      let linha = ''

      for (const item of conteudo.items) {
        if (!('str' in item)) continue
        linha += item.str
        if (item.hasEOL) {
          linhas.push(linha)
          linha = ''
        }
      }
      if (linha.length > 0) linhas.push(linha)

      partes.push(linhas.join('\n'))
      pagina.cleanup()
    }
  } finally {
    await tarefa.destroy()
  }

  const texto = juntarLinhas(partes.join('\n\n'))
  if (texto.trim().length === 0) {
    throw new ErroDeArquivo('Este PDF não tem texto selecionável — provavelmente é um documento digitalizado (imagem).')
  }
  return { nome: arquivo.name, texto, paginas }
}

async function lerTextoPuro(arquivo: File): Promise<ArquivoLido> {
  const texto = await arquivo.text()
  // Bytes nulos denunciam um arquivo binário com extensão enganosa.
  if (texto.slice(0, 4000).includes('\u0000')) {
    throw new ErroDeArquivo('Este arquivo não parece conter texto. Use PDF, Word (.docx) ou TXT.')
  }
  return { nome: arquivo.name, texto }
}

/** Abre o arquivo e devolve o texto pronto para a leitura em voz alta. */
export async function extrairTexto(arquivo: File): Promise<ArquivoLido> {
  if (arquivo.size > TAMANHO_MAXIMO) {
    throw new ErroDeArquivo('Arquivo grande demais (o limite é 30 MB).')
  }

  const tipo = extensao(arquivo.name)

  try {
    if (tipo === 'pdf' || arquivo.type === 'application/pdf') {
      return await lerPdf(arquivo)
    }
    if (tipo === 'docx' || arquivo.type.includes('wordprocessingml')) {
      const xml = await lerZip(arquivo, 'word/document.xml')
      return { nome: arquivo.name, texto: textoDoDocx(xml) }
    }
    if (tipo === 'odt' || arquivo.type.includes('opendocument.text')) {
      const xml = await lerZip(arquivo, 'content.xml')
      return { nome: arquivo.name, texto: textoDoOdt(xml) }
    }
    if (tipo === 'doc') {
      throw new ErroDeArquivo('O formato .doc (Word antigo) não é lido aqui. Salve como .docx ou PDF.')
    }
    if (tipo === 'pages' || tipo === 'rtf' || tipo === 'epub') {
      throw new ErroDeArquivo(`Arquivos .${tipo} não são lidos aqui. Exporte como PDF, .docx ou .txt.`)
    }
    return await lerTextoPuro(arquivo)
  } catch (erro) {
    if (erro instanceof ErroDeArquivo) throw erro
    const nome = erro instanceof Error ? erro.name : ''
    if (nome === 'PasswordException') throw new ErroDeArquivo('Este PDF está protegido por senha.')
    if (nome === 'InvalidPDFException') throw new ErroDeArquivo('Este PDF está corrompido ou não pôde ser aberto.')
    throw new ErroDeArquivo('Não foi possível ler este arquivo. Tente outro formato (PDF, .docx ou .txt).')
  }
}

/** Idiomas oferecidos na página e escolha da voz do navegador. */

export interface Idioma {
  /** Código passado para a síntese de voz. */
  codigo: string
  /** Prefixo usado para casar com as vozes instaladas. */
  prefixo: string
  nome: string
  /** Rótulo curto do botão. */
  sigla: string
  exemplo: string
}

export const IDIOMAS: Idioma[] = [
  {
    codigo: 'pt-BR',
    prefixo: 'pt',
    nome: 'Português',
    sigla: 'PT',
    exemplo:
      'A leitura em voz alta ajuda a revisar um texto antes de publicar. ' +
      'Cole aqui o seu próprio conteúdo, escolha a voz e ajuste a velocidade.\n' +
      'Durante a leitura, clique em qualquer palavra para continuar a partir dela.',
  },
  {
    codigo: 'en-US',
    prefixo: 'en',
    nome: 'English',
    sigla: 'EN',
    exemplo:
      'Reading a text out loud is a good way to review it before publishing. ' +
      'Paste your own content here, pick a voice and adjust the speed.\n' +
      'While it reads, click any word to continue from that point.',
  },
  {
    codigo: 'es-ES',
    prefixo: 'es',
    nome: 'Español',
    sigla: 'ES',
    exemplo:
      'Leer un texto en voz alta ayuda a revisarlo antes de publicarlo. ' +
      'Pega aquí tu propio contenido, elige la voz y ajusta la velocidad.\n' +
      'Durante la lectura, haz clic en cualquier palabra para seguir desde ahí.',
  },
]

export function idiomaPorCodigo(codigo: string): Idioma {
  return IDIOMAS.find((idioma) => idioma.codigo === codigo) ?? IDIOMAS[0]
}

/** `pt_BR` e `pt-br` aparecem conforme o sistema; aqui vira sempre `pt-br`. */
function normalizar(lang: string): string {
  return lang.replace('_', '-').toLowerCase()
}

/**
 * A voz que lê português da forma mais fluente que encontramos. Quando ela
 * existe no aparelho (Windows com Edge, em geral), é a escolha inicial.
 */
const PREFERIDA = 'thalita'

/** Marcas de nome das vozes novas, sintetizadas por rede neural. */
const NATURAIS = ['multilingual', 'natural', 'neural', 'online', 'premium', 'enhanced', 'siri', 'google']

/** Marcas das vozes antigas, de sonoridade mecânica. */
const ARTIFICIAIS = ['desktop', 'compact', 'espeak', 'pico', 'sapi']

/**
 * Nota de qualidade de uma voz, usada para ordenar a lista e escolher a
 * inicial. Quanto maior, mais natural tende a ser a leitura.
 */
export function qualidadeDaVoz(voz: SpeechSynthesisVoice, idioma: Idioma): number {
  const nome = voz.name.toLowerCase()
  let nota = 0
  if (nome.includes(PREFERIDA)) nota += 1000
  // pt-BR antes de pt-PT quando o idioma escolhido é o do Brasil.
  if (normalizar(voz.lang) === normalizar(idioma.codigo)) nota += 100
  if (NATURAIS.some((marca) => nome.includes(marca))) nota += 40
  if (ARTIFICIAIS.some((marca) => nome.includes(marca))) nota -= 60
  if (voz.default) nota += 5
  return nota
}

/**
 * Vozes instaladas para um idioma, da que lê melhor para a que lê pior: a
 * preferida primeiro, depois as do dialeto exato e as de som mais natural.
 */
export function vozesDoIdioma(vozes: SpeechSynthesisVoice[], idioma: Idioma): SpeechSynthesisVoice[] {
  return vozes
    .filter((voz) => normalizar(voz.lang).startsWith(idioma.prefixo))
    .sort((a, b) => {
      const nota = qualidadeDaVoz(b, idioma) - qualidadeDaVoz(a, idioma)
      if (nota !== 0) return nota
      return a.name.localeCompare(b.name)
    })
}

/**
 * A voz que a pessoa escolheu à mão, se ainda existir neste aparelho; senão,
 * a primeira da lista — que já vem ordenada da melhor para a pior.
 */
export function escolherVoz(
  disponiveis: SpeechSynthesisVoice[],
  preferida: string | null,
): SpeechSynthesisVoice | null {
  if (disponiveis.length === 0) return null
  if (preferida) {
    const salva = disponiveis.find((voz) => voz.voiceURI === preferida)
    if (salva) return salva
  }
  return disponiveis[0]
}

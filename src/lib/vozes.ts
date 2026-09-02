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
 * Vozes instaladas para um idioma, das mais adequadas para as menos: primeiro
 * as do dialeto exato (pt-BR antes de pt-PT), depois as que rodam no próprio
 * aparelho — que não dependem da internet e começam a falar mais rápido.
 */
export function vozesDoIdioma(vozes: SpeechSynthesisVoice[], idioma: Idioma): SpeechSynthesisVoice[] {
  const alvo = normalizar(idioma.codigo)
  return vozes
    .filter((voz) => normalizar(voz.lang).startsWith(idioma.prefixo))
    .sort((a, b) => {
      const exata = Number(normalizar(b.lang) === alvo) - Number(normalizar(a.lang) === alvo)
      if (exata !== 0) return exata
      const local = Number(b.localService) - Number(a.localService)
      if (local !== 0) return local
      return a.name.localeCompare(b.name)
    })
}

/** A voz salva pela pessoa, se ainda existir; senão, a melhor do idioma. */
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

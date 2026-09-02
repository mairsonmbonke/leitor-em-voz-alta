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
]

export function vozNaturalDoIdioma(idioma: string): VozNatural | null {
  return VOZES_NATURAIS.find((voz) => voz.idioma === idioma) ?? null
}

/** Andamento do download, de 0 a 1. */
export type AoBaixar = (fracao: number) => void

/** O pedaço da biblioteca que a página usa. */
interface Motor {
  download: (id: string, progresso: (p: { url: string; loaded: number; total: number }) => void) => Promise<void>
  predict: (config: { text: string; voiceId: string }) => Promise<Blob>
  stored: () => Promise<string[]>
  remove: (id: string) => Promise<void>
}

let motor: Motor | null = null

/** Troca o motor por um de mentira. Usado pelos testes de interface. */
export function definirMotor(falso: Motor | null): void {
  motor = falso
}

async function carregarMotor(): Promise<Motor> {
  // Os testes de interface põem um motor de mentira aqui para exercitar a
  // leitura sem baixar 60 MB de modelo a cada execução.
  const deTeste = (globalThis as { __motorDeVozDeTeste?: Motor }).__motorDeVozDeTeste
  if (deTeste) return deTeste
  if (!motor) motor = (await import('@mintplex-labs/piper-tts-web')) as unknown as Motor
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

/** Baixa o modelo e guarda no navegador. */
export async function baixar(id: string, aoBaixar?: AoBaixar): Promise<void> {
  const lib = await carregarMotor()
  await lib.download(id, ({ loaded, total }) => {
    if (total > 0) aoBaixar?.(Math.min(1, loaded / total))
  })
  aoBaixar?.(1)
}

/** Gera o áudio de um trecho de texto. */
export async function sintetizar(id: string, texto: string): Promise<Blob> {
  const lib = await carregarMotor()
  return lib.predict({ text: texto, voiceId: id })
}

/** Apaga o modelo baixado, devolvendo o espaço ao aparelho. */
export async function apagar(id: string): Promise<void> {
  const lib = await carregarMotor()
  await lib.remove(id)
}

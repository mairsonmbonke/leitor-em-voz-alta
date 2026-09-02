import { useCallback, useEffect, useRef, useState } from 'react'
import { trechoNaPosicao, type Palavra, type Trecho } from './lib/leitura'

/** A síntese de voz existe neste navegador? */
export const TEM_VOZ = typeof window !== 'undefined' && 'speechSynthesis' in window

export type EstadoLeitura = 'parado' | 'lendo' | 'pausado'

export interface Ajustes {
  idioma: string
  voz: SpeechSynthesisVoice | null
  velocidade: number
}

export interface Leitura {
  estado: EstadoLeitura
  /** Onde a leitura está agora, em caracteres do texto original. */
  posicao: number
  /** Palavra sendo falada, quando o navegador informa o andamento. */
  destaque: Palavra | null
  /** Trecho sendo falado, ou -1. */
  indice: number
  erro: string | null
  /** A fala está sendo preparada (só a voz natural leva um instante). */
  preparando: boolean
  iniciar: (posicao?: number) => void
  pausar: () => void
  continuar: () => void
  parar: () => void
  /** Aplica voz, idioma ou velocidade novos sem perder o ponto da leitura. */
  reiniciar: () => void
}

/**
 * Navegadores baseados no Chrome interrompem falas longas depois de cerca de
 * 15 segundos. Um `pause()`+`resume()` periódico zera esse relógio.
 */
const INTERVALO_KEEPALIVE = 9000
/** Quanto esperar para saber se o `pause()` do navegador funcionou mesmo. */
const CONFERIR_PAUSA = 350

/**
 * Conduz a leitura em voz alta trecho a trecho.
 *
 * O estado que muda a cada palavra fica em refs, e não em estado do React, para
 * que os retornos de chamada da síntese — que sobrevivem a várias renderizações
 * — sempre enxerguem o valor atual. Cada fala recebe uma senha (`senhaRef`):
 * quando a leitura é cancelada, a senha muda e os eventos da fala antiga são
 * descartados em vez de fazer a leitura pular sozinha para o trecho seguinte.
 */
export function useLeitura(trechos: Trecho[], ajustes: Ajustes): Leitura {
  const [estado, setEstado] = useState<EstadoLeitura>('parado')
  const [posicao, setPosicao] = useState(0)
  const [destaque, setDestaque] = useState<Palavra | null>(null)
  const [indice, setIndice] = useState(-1)
  const [erro, setErro] = useState<string | null>(null)

  const trechosRef = useRef(trechos)
  const ajustesRef = useRef(ajustes)
  const estadoRef = useRef<EstadoLeitura>('parado')
  const senhaRef = useRef(0)
  /** De onde recomeçar: a última palavra falada. */
  const retomarRef = useRef(0)
  /** O navegador não pausou de verdade e a fala teve de ser cortada. */
  const pausaCortadaRef = useRef(false)

  trechosRef.current = trechos
  ajustesRef.current = ajustes

  const mudarEstado = useCallback((novo: EstadoLeitura) => {
    estadoRef.current = novo
    setEstado(novo)
  }, [])

  const cancelar = useCallback(() => {
    senhaRef.current += 1
    pausaCortadaRef.current = false
    if (TEM_VOZ) window.speechSynthesis.cancel()
  }, [])

  const falar = useCallback(
    (de: number) => {
      if (!TEM_VOZ) return
      const lista = trechosRef.current
      const alvo = trechoNaPosicao(lista, de)
      if (alvo < 0) {
        // Chegou ao fim do texto.
        senhaRef.current += 1
        window.speechSynthesis.cancel()
        mudarEstado('parado')
        setDestaque(null)
        setIndice(-1)
        setPosicao(lista.length > 0 ? lista[lista.length - 1].fim : 0)
        return
      }

      const trecho = lista[alvo]
      const inicio = Math.max(de, trecho.inicio)
      const conteudo = trecho.texto.slice(inicio - trecho.inicio)
      if (conteudo.trim().length === 0) {
        falar(trecho.fim)
        return
      }

      senhaRef.current += 1
      const senha = senhaRef.current
      pausaCortadaRef.current = false
      retomarRef.current = inicio

      setIndice(alvo)
      setPosicao(inicio)
      setDestaque(null)
      mudarEstado('lendo')

      const { idioma, voz, velocidade } = ajustesRef.current
      const fala = new SpeechSynthesisUtterance(conteudo)
      fala.lang = voz?.lang ?? idioma
      if (voz) fala.voice = voz
      fala.rate = velocidade

      fala.onboundary = (evento) => {
        if (senha !== senhaRef.current) return
        if (evento.name && evento.name !== 'word') return

        // O navegador conta a partir do início desta fala; aqui vira posição
        // no texto inteiro. Alguns apontam para o espaço antes da palavra.
        let rel = inicio - trecho.inicio + evento.charIndex
        while (rel < trecho.texto.length && /\s/.test(trecho.texto[rel])) rel += 1
        if (rel >= trecho.texto.length) return

        let fim = evento.charLength > 0 ? rel + evento.charLength : rel
        if (fim <= rel) {
          fim = rel
          while (fim < trecho.texto.length && !/\s/.test(trecho.texto[fim])) fim += 1
        }
        fim = Math.min(fim, trecho.texto.length)

        const palavra: Palavra = {
          inicio: trecho.inicio + rel,
          fim: trecho.inicio + fim,
          texto: trecho.texto.slice(rel, fim),
        }
        retomarRef.current = palavra.inicio
        setDestaque(palavra)
        setPosicao(palavra.inicio)
      }

      fala.onend = () => {
        if (senha !== senhaRef.current) return
        retomarRef.current = trecho.fim
        falar(trecho.fim)
      }

      fala.onerror = (evento) => {
        if (senha !== senhaRef.current) return
        if (evento.error === 'interrupted' || evento.error === 'canceled') return
        setErro('O navegador não conseguiu ler este texto. Tente outra voz.')
        mudarEstado('parado')
        setDestaque(null)
        setIndice(-1)
      }

      window.speechSynthesis.speak(fala)
    },
    [mudarEstado],
  )

  const iniciar = useCallback(
    (de = 0) => {
      if (!TEM_VOZ) return
      setErro(null)
      cancelar()
      falar(de)
    },
    [cancelar, falar],
  )

  const pausar = useCallback(() => {
    if (!TEM_VOZ || estadoRef.current !== 'lendo') return
    window.speechSynthesis.pause()
    mudarEstado('pausado')

    // No Android o `pause()` costuma ser ignorado. Se a fala continuar, ela é
    // cortada e o `Continuar` recomeça da palavra em que parou.
    window.setTimeout(() => {
      if (estadoRef.current !== 'pausado') return
      const sintese = window.speechSynthesis
      if (sintese.speaking && !sintese.paused) {
        senhaRef.current += 1
        sintese.cancel()
        pausaCortadaRef.current = true
      }
    }, CONFERIR_PAUSA)
  }, [mudarEstado])

  const continuar = useCallback(() => {
    if (!TEM_VOZ || estadoRef.current !== 'pausado') return
    if (pausaCortadaRef.current) {
      pausaCortadaRef.current = false
      falar(retomarRef.current)
      return
    }
    window.speechSynthesis.resume()
    mudarEstado('lendo')
  }, [falar, mudarEstado])

  const parar = useCallback(() => {
    cancelar()
    mudarEstado('parado')
    setDestaque(null)
    setIndice(-1)
    setPosicao(0)
  }, [cancelar, mudarEstado])

  /** Voz, idioma ou velocidade mudaram no meio da leitura. */
  const reiniciar = useCallback(() => {
    if (estadoRef.current === 'lendo') {
      falar(retomarRef.current)
    } else if (estadoRef.current === 'pausado' && !pausaCortadaRef.current) {
      // A fala pausada guarda os ajustes antigos: corta agora e recomeça com
      // os novos quando a pessoa clicar em Continuar.
      senhaRef.current += 1
      window.speechSynthesis.cancel()
      pausaCortadaRef.current = true
    }
  }, [falar])

  // Mantém viva a fala longa e devolve tudo ao normal ao sair da página.
  useEffect(() => {
    if (!TEM_VOZ) return
    const relogio = window.setInterval(() => {
      if (estadoRef.current !== 'lendo') return
      const sintese = window.speechSynthesis
      if (!sintese.speaking || sintese.paused) return
      sintese.pause()
      sintese.resume()
    }, INTERVALO_KEEPALIVE)

    return () => {
      window.clearInterval(relogio)
      senhaRef.current += 1
      window.speechSynthesis.cancel()
    }
  }, [])

  // A voz do sistema fala na hora: nunca há espera para mostrar.
  return {
    estado,
    posicao,
    destaque,
    indice,
    erro,
    preparando: false,
    iniciar,
    pausar,
    continuar,
    parar,
    reiniciar,
  }
}

/** Lista de vozes do navegador, que costuma chegar depois do primeiro render. */
export function useVozes(): SpeechSynthesisVoice[] {
  const [vozes, setVozes] = useState<SpeechSynthesisVoice[]>([])

  useEffect(() => {
    if (!TEM_VOZ) return
    const sintese = window.speechSynthesis

    const atualizar = () => setVozes(sintese.getVoices())
    atualizar()
    sintese.addEventListener('voiceschanged', atualizar)

    // Em alguns navegadores o evento não chega; uma reconferência resolve.
    const tentativas = [200, 700, 1500].map((espera) => window.setTimeout(atualizar, espera))

    return () => {
      sintese.removeEventListener('voiceschanged', atualizar)
      tentativas.forEach(window.clearTimeout)
    }
  }, [])

  return vozes
}

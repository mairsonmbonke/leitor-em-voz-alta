import { useCallback, useEffect, useRef, useState } from 'react'
import { dividirEmPalavras, trechoNaPosicao, type Palavra, type Trecho } from './lib/leitura'
import { distribuirTempos, palavraNoTempo, type Tempo } from './lib/tempos'
import { sintetizar, type VozNatural } from './lib/vozNatural'
import type { EstadoLeitura, Leitura } from './useLeitura'

/**
 * Leitura com a voz natural que roda no próprio aparelho.
 *
 * Tem a mesma forma do `useLeitura` (que usa a voz do sistema), então a tela
 * troca de um para o outro sem saber a diferença. O que muda por dentro: aqui
 * a fala é um arquivo de áudio gerado frase a frase, e não um comando para o
 * navegador falar.
 *
 * Enquanto uma frase toca, a seguinte já vai sendo gerada em segundo plano —
 * é isso que faz a leitura emendar sem buracos.
 */

/** Silêncio de um instante, para destravar o áudio no toque da pessoa. */
const SILENCIO =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA='

/** Quantas frases adiante ficam prontas na memória. */
const ADIANTAMENTO = 2

export function useLeituraNatural(trechos: Trecho[], voz: VozNatural | null, velocidade: number): Leitura {
  const [estado, setEstado] = useState<EstadoLeitura>('parado')
  const [posicao, setPosicao] = useState(0)
  const [destaque, setDestaque] = useState<Palavra | null>(null)
  const [indice, setIndice] = useState(-1)
  const [erro, setErro] = useState<string | null>(null)
  const [preparando, setPreparando] = useState(false)

  const trechosRef = useRef(trechos)
  const vozRef = useRef(voz)
  const estadoRef = useRef<EstadoLeitura>('parado')
  const senhaRef = useRef(0)
  const retomarRef = useRef(0)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const urlRef = useRef<string | null>(null)
  const palavrasRef = useRef<Palavra[]>([])
  const temposRef = useRef<Tempo[]>([])
  const quadroRef = useRef(0)
  /** Frases já geradas, prontas para tocar. */
  const prontasRef = useRef(new Map<number, Promise<Blob>>())

  trechosRef.current = trechos
  vozRef.current = voz

  const mudarEstado = useCallback((novo: EstadoLeitura) => {
    estadoRef.current = novo
    setEstado(novo)
  }, [])

  /**
   * O elemento de áudio, criado uma vez só. Ele fica no documento (invisível):
   * navegadores de celular tratam melhor um elemento que está na página, e
   * assim também dá para inspecioná-lo.
   */
  const pegarAudio = useCallback(() => {
    if (!audioRef.current) {
      const audio = new Audio()
      audio.preload = 'auto'
      audio.preservesPitch = true
      audio.hidden = true
      audio.dataset.leitor = 'voz-natural'
      document.body.appendChild(audio)
      audioRef.current = audio
    }
    return audioRef.current
  }, [])

  const pararQuadros = useCallback(() => {
    if (quadroRef.current) cancelAnimationFrame(quadroRef.current)
    quadroRef.current = 0
  }, [])

  const limpar = useCallback(() => {
    senhaRef.current += 1
    pararQuadros()
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.removeAttribute('src')
    }
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    }
  }, [pararQuadros])

  /**
   * Gera o áudio de um texto. Com `chave`, guarda o resultado para reaproveitar
   * (é o caso das frases inteiras); sem ela, o trecho começa no meio de uma
   * frase — coisa de clique — e não vale a pena guardar.
   */
  const gerar = useCallback((chave: number | null, texto: string): Promise<Blob> => {
    const escolhida = vozRef.current
    if (!escolhida) return Promise.reject(new Error('Nenhuma voz natural escolhida.'))

    if (chave === null) return sintetizar(escolhida.id, texto)

    const guardada = prontasRef.current.get(chave)
    if (guardada) return guardada

    const promessa = sintetizar(escolhida.id, texto)
    prontasRef.current.set(chave, promessa)
    // Uma promessa recusada não pode ficar guardada, senão trava a frase.
    promessa.catch(() => prontasRef.current.delete(chave))
    return promessa
  }, [])

  /** Deixa as próximas frases prontas enquanto esta toca. */
  const adiantar = useCallback(
    (aPartirDe: number) => {
      const lista = trechosRef.current
      for (let i = aPartirDe; i < Math.min(lista.length, aPartirDe + ADIANTAMENTO); i += 1) {
        void gerar(lista[i].inicio, lista[i].texto).catch(() => undefined)
      }
      // Não guarda o livro inteiro na memória: o que já passou é descartado.
      for (const chave of prontasRef.current.keys()) {
        if (chave < (lista[aPartirDe]?.inicio ?? 0)) prontasRef.current.delete(chave)
      }
    },
    [gerar],
  )

  /** Segue o áudio e move o destaque de palavra em palavra. */
  const acompanhar = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    const seguir = () => {
      const qual = palavraNoTempo(temposRef.current, audio.currentTime)
      const palavra = qual >= 0 ? palavrasRef.current[qual] : null
      if (palavra) {
        retomarRef.current = palavra.inicio
        setDestaque(palavra)
        setPosicao(palavra.inicio)
      }
      quadroRef.current = requestAnimationFrame(seguir)
    }
    pararQuadros()
    quadroRef.current = requestAnimationFrame(seguir)
  }, [pararQuadros])

  const falar = useCallback(
    async (de: number) => {
      const lista = trechosRef.current
      const alvo = trechoNaPosicao(lista, de)
      if (alvo < 0) {
        limpar()
        mudarEstado('parado')
        setPreparando(false)
        setDestaque(null)
        setIndice(-1)
        setPosicao(lista.length > 0 ? lista[lista.length - 1].fim : 0)
        return
      }

      const trecho = lista[alvo]
      const inicio = Math.max(de, trecho.inicio)
      const texto = trecho.texto.slice(inicio - trecho.inicio)
      if (texto.trim().length === 0) {
        await falar(trecho.fim)
        return
      }

      limpar()
      const senha = senhaRef.current
      retomarRef.current = inicio

      setIndice(alvo)
      setPosicao(inicio)
      setDestaque(null)
      mudarEstado('lendo')
      setPreparando(true)

      let audio: Blob
      try {
        audio = await gerar(inicio === trecho.inicio ? trecho.inicio : null, texto)
      } catch {
        if (senha !== senhaRef.current) return
        setErro('Não foi possível gerar a voz natural. Volte para a voz do aparelho e tente de novo.')
        mudarEstado('parado')
        setPreparando(false)
        return
      }
      if (senha !== senhaRef.current) return

      const tocador = pegarAudio()
      const url = URL.createObjectURL(audio)
      urlRef.current = url
      palavrasRef.current = dividirEmPalavras(trecho).filter((palavra) => palavra.fim > inicio)
      temposRef.current = []

      tocador.onloadedmetadata = () => {
        if (senha !== senhaRef.current) return
        temposRef.current = distribuirTempos(palavrasRef.current, tocador.duration)
      }
      tocador.onended = () => {
        if (senha !== senhaRef.current) return
        retomarRef.current = trecho.fim
        void falar(trecho.fim)
      }
      tocador.onerror = () => {
        if (senha !== senhaRef.current) return
        setErro('O navegador não conseguiu tocar o áudio gerado.')
        mudarEstado('parado')
        setPreparando(false)
      }

      tocador.src = url
      tocador.playbackRate = velocidade
      try {
        await tocador.play()
      } catch {
        // Alguns navegadores só tocam depois de um toque na tela.
        if (senha !== senhaRef.current) return
        setErro('Toque em Ouvir novamente para liberar o som neste navegador.')
        mudarEstado('parado')
        setPreparando(false)
        return
      }
      if (senha !== senhaRef.current) return

      setPreparando(false)
      acompanhar()
      adiantar(alvo + 1)
    },
    [acompanhar, adiantar, gerar, limpar, mudarEstado, pegarAudio, velocidade],
  )

  const iniciar = useCallback(
    (de = 0) => {
      setErro(null)
      // O toque da pessoa é o que libera o som no celular: o áudio precisa
      // começar agora, ainda dentro do clique, antes de qualquer espera.
      const tocador = pegarAudio()
      tocador.src = SILENCIO
      void tocador.play().catch(() => undefined)
      void falar(de)
    },
    [falar, pegarAudio],
  )

  const pausar = useCallback(() => {
    if (estadoRef.current !== 'lendo') return
    audioRef.current?.pause()
    pararQuadros()
    mudarEstado('pausado')
  }, [mudarEstado, pararQuadros])

  const continuar = useCallback(() => {
    if (estadoRef.current !== 'pausado') return
    const tocador = audioRef.current
    if (!tocador) return
    void tocador.play().catch(() => undefined)
    mudarEstado('lendo')
    acompanhar()
  }, [acompanhar, mudarEstado])

  const parar = useCallback(() => {
    limpar()
    prontasRef.current.clear()
    mudarEstado('parado')
    setPreparando(false)
    setDestaque(null)
    setIndice(-1)
    setPosicao(0)
  }, [limpar, mudarEstado])

  /** Voz nova: refaz a frase atual a partir da palavra em que está. */
  const reiniciar = useCallback(() => {
    prontasRef.current.clear()
    if (estadoRef.current === 'lendo') void falar(retomarRef.current)
    else if (estadoRef.current === 'pausado') limpar()
  }, [falar, limpar])

  // A velocidade é só a rotação do áudio: muda na hora, sem refazer a fala.
  useEffect(() => {
    const tocador = audioRef.current
    if (tocador) tocador.playbackRate = velocidade
  }, [velocidade])

  // Ao sair da página, o áudio para e sai do documento junto.
  useEffect(() => {
    return () => {
      senhaRef.current += 1
      if (quadroRef.current) cancelAnimationFrame(quadroRef.current)
      audioRef.current?.pause()
      audioRef.current?.remove()
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    }
  }, [])

  return { estado, posicao, destaque, indice, erro, preparando, iniciar, pausar, continuar, parar, reiniciar }
}

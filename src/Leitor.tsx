import {
  Fragment,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
} from 'react'
import { Frase } from './Frase'
import { TEM_VOZ, useLeitura, useVozes } from './useLeitura'
import { useLeituraNatural } from './useLeituraNatural'
import {
  ErroDeVoz,
  baixar,
  esquecerFalha,
  jaBaixadas,
  suportaVozNatural,
  ultimaFalha,
  vozNaturalDoIdioma,
  type Andamento,
} from './lib/vozNatural'
import {
  VELOCIDADE_MAX,
  VELOCIDADE_MIN,
  VELOCIDADE_PADRAO,
  contarPalavras,
  estimarSegundos,
  limitarVelocidade,
  progresso,
  segmentar,
  type Trecho,
} from './lib/leitura'
import { IDIOMAS, escolherVoz, idiomaPorCodigo, vozesDoIdioma } from './lib/vozes'
import {
  ErroDeArquivo,
  MAXIMO_DE_PAGINAS_OCR,
  TIPOS_ACEITOS,
  extrairTexto,
  navegadorAbreImagem,
  paginasComoImagens,
} from './lib/documento'
import { ErroDeOcr, ehHeic, reconhecerImagem, reconhecerPaginas } from './lib/ocr'
import { ErroDeTraducao, detectarIdioma, emParagrafos, traduzirParagrafos } from './lib/traducao'
import * as drive from './lib/drive'
import { formatDuration } from './lib/format'
import {
  IconAlert,
  IconArrowDown,
  IconNuvem,
  IconTraduzir,
  IconClipboard,
  IconPause,
  IconPencil,
  IconPlay,
  IconSpeaker,
  IconSpinner,
  IconStop,
  IconTrash,
  IconUpload,
  IconWand,
} from './icons'

const CHAVE_TEXTO = 'leitor.texto'
const CHAVE_IDIOMA = 'leitor.idioma'
const CHAVE_VELOCIDADE = 'leitor.velocidade'
const chaveVoz = (idioma: string) => `leitor.voz.${idioma}`
const CHAVE_FONTE = 'leitor.fonte'

/** De onde sai a voz: do sistema do aparelho ou do modelo baixado. */
type Fonte = 'aparelho' | 'natural'

/** Espera antes de aplicar um ajuste feito no meio da leitura. */
const ESPERA_AJUSTE = 260
/** Distância mínima entre o trecho lido e a borda da área de texto. */
const FOLGA_ROLAGEM = 48
/** Intervalo mínimo entre duas rolagens automáticas. */
const ESPERA_ROLAGEM = 400
/**
 * Por quanto tempo, depois de a página rolar sozinha, as rolagens que chegam
 * ainda são consideradas nossas.
 *
 * Arrastar a barra de rolagem, ou usar as teclas, não dispara `wheel` nem
 * `touchmove` — só `scroll`, o mesmo evento que a rolagem automática dispara.
 * Esta janela separa uma da outra.
 */
const MARGEM_DA_ROLAGEM = 900

type Versao = 'original' | 'traducao'

const aOutra = (qual: Versao): Versao => (qual === 'original' ? 'traducao' : 'original')

/** Bytes em megabytes, do jeito que se lê. */
function emMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** O que dizer enquanto a voz natural é preparada. */
function recadoDoDownload(andamento: Andamento): string {
  if (andamento.etapa === 'ajustes') return 'Buscando os ajustes da voz…'
  if (andamento.etapa === 'guardando') return 'Guardando a voz no aparelho…'
  if (andamento.total > 0) return `Baixando a voz: ${emMB(andamento.baixados)} de ${emMB(andamento.total)}`
  return `Baixando a voz: ${emMB(andamento.baixados)}`
}

function ler(chave: string): string | null {
  try {
    return localStorage.getItem(chave)
  } catch {
    return null
  }
}

function salvar(chave: string, valor: string): void {
  try {
    localStorage.setItem(chave, valor)
  } catch {
    /* navegador com armazenamento bloqueado */
  }
}

export function Leitor() {
  const [texto, setTexto] = useState(() => ler(CHAVE_TEXTO) ?? '')
  const [editando, setEditando] = useState(() => (ler(CHAVE_TEXTO) ?? '').trim().length === 0)
  const [idioma, setIdioma] = useState(() => {
    const salvo = ler(CHAVE_IDIOMA)
    return IDIOMAS.some((item) => item.codigo === salvo) ? (salvo as string) : IDIOMAS[0].codigo
  })
  const [vozURI, setVozURI] = useState<string | null>(() => ler(chaveVoz(idioma)))
  const [velocidade, setVelocidade] = useState(() => limitarVelocidade(Number(ler(CHAVE_VELOCIDADE))))
  const [recado, setRecado] = useState<string | null>(null)
  const [fonte, setFonte] = useState<Fonte>(() => (ler(CHAVE_FONTE) === 'natural' ? 'natural' : 'aparelho'))
  const [baixada, setBaixada] = useState(false)
  const [baixando, setBaixando] = useState<Andamento | null>(null)
  /** A voz natural falhou: a mensagem para a tela e a explicação técnica. */
  const [falhaDaVoz, setFalhaDaVoz] = useState<{ mensagem: string; detalhe: string } | null>(null)
  const [verDetalhe, setVerDetalhe] = useState(false)
  /** Como desistir de um download de 60 MB que está demorando. */
  const baixadorRef = useRef<AbortController | null>(null)
  const [arquivo, setArquivo] = useState<string | null>(null)
  /** A tela acompanha a leitura? Uma rolagem manual desliga isto. */
  const [acompanhando, setAcompanhando] = useState(true)
  /** Tradução pronta do texto atual, quando existe. */
  const [traducao, setTraducao] = useState<{ de: string; para: string; texto: string } | null>(null)
  /** Qual das duas versões está sendo lida e mostrada. */
  const [versao, setVersao] = useState<Versao>('original')
  const [destino, setDestino] = useState('en-US')
  /** Idioma de origem escolhido à mão; `null` significa "descobrir sozinho". */
  const [origemManual, setOrigemManual] = useState<string | null>(null)
  /** O que a descoberta automática encontrou no texto atual. */
  const [detectado, setDetectado] = useState<string | null>(null)
  /**
   * O painel de tradução está aberto? No computador sim, desde o começo. No
   * celular ele começa fechado: a altura da tela é curta e o texto precisa
   * dela — o botão "Traduzir" abre e fecha.
   */
  const [traducaoAberta, setTraducaoAberta] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches,
  )
  /** Andamento de uma tarefa demorada (tradução ou reconhecimento). */
  const [tarefa, setTarefa] = useState<{ nome: string; etapa: string; fracao: number } | null>(null)
  /** Como cancelar a tarefa em andamento. */
  const cancelador = useRef<AbortController | null>(null)
  /** A conta do Google conectada, quando existe. */
  const [contaDrive, setContaDrive] = useState<drive.SessaoDoDrive | null>(() => drive.sessaoAtual())
  const [conectandoDrive, setConectandoDrive] = useState(false)
  const [abrindo, setAbrindo] = useState(false)
  const [arrastando, setArrastando] = useState(false)

  const areaRef = useRef<HTMLDivElement>(null)
  /** O painel de comparação, com a versão que não está sendo lida. */
  const comparacaoRef = useRef<HTMLDivElement>(null)
  const campoRef = useRef<HTMLTextAreaElement>(null)
  const seletorRef = useRef<HTMLInputElement>(null)

  /** Até quando uma rolagem que chegar ainda é nossa, e não da pessoa. */
  const rolagemNossa = useRef(0)
  /**
   * Onde cada versão foi deixada. Original e tradução guardam a própria
   * posição: trocar de aba devolve a tela exatamente ao ponto de antes.
   */
  const posicoes = useRef<Record<Versao, number>>({ original: 0, traducao: 0 })
  const esquecerPosicoes = useCallback(() => {
    posicoes.current = { original: 0, traducao: 0 }
  }, [])

  // Quando há tradução, ela pode ocupar o lugar do original: a leitura, as
  // vozes e o destaque passam a trabalhar sobre a versão escolhida.
  const mostrandoTraducao = versao === 'traducao' && traducao !== null
  const textoAtivo = mostrandoTraducao ? traducao.texto : texto
  const idiomaAtivo = mostrandoTraducao ? traducao.para : idioma

  const idiomaAtual = idiomaPorCodigo(idiomaAtivo)
  const vozes = useVozes()
  const disponiveis = useMemo(() => vozesDoIdioma(vozes, idiomaAtual), [vozes, idiomaAtual])
  const voz = useMemo(() => escolherVoz(disponiveis, vozURI), [disponiveis, vozURI])

  const naturalDoIdioma = vozNaturalDoIdioma(idiomaAtivo)
  const temNatural = suportaVozNatural() && naturalDoIdioma !== null
  // Sem o modelo baixado, a voz do aparelho continua no comando.
  const usandoNatural = fonte === 'natural' && temNatural && baixada

  const trechos = useMemo(() => segmentar(textoAtivo), [textoAtivo])
  const doAparelho = useLeitura(trechos, { idioma: idiomaAtivo, voz, velocidade })
  const daNatural = useLeituraNatural(trechos, usandoNatural ? naturalDoIdioma : null, velocidade)
  const leitura = usandoNatural ? daNatural : doAparelho
  const { estado, indice, destaque, posicao, preparando, iniciar, pausar, continuar, parar, reiniciar } = leitura

  const paragrafos = useMemo(() => {
    const grupos: Trecho[][] = []
    for (const trecho of trechos) {
      const ultimo = grupos[grupos.length - 1]
      if (ultimo && ultimo[0].paragrafo === trecho.paragrafo) ultimo.push(trecho)
      else grupos.push([trecho])
    }
    return grupos
  }, [trechos])

  const palavras = useMemo(() => contarPalavras(textoAtivo), [textoAtivo])
  const andamento = progresso(trechos, posicao)
  const restante = estimarSegundos(palavras * (1 - andamento), velocidade)
  const tocando = estado === 'lendo'
  const ativo = estado !== 'parado'
  const semTexto = trechos.length === 0

  // ── Persistência ──────────────────────────────────────────────────────
  useEffect(() => {
    const espera = window.setTimeout(() => salvar(CHAVE_TEXTO, texto), 400)
    return () => window.clearTimeout(espera)
  }, [texto])

  useEffect(() => salvar(CHAVE_IDIOMA, idioma), [idioma])
  useEffect(() => salvar(CHAVE_FONTE, fonte), [fonte])
  useEffect(() => salvar(CHAVE_VELOCIDADE, String(velocidade)), [velocidade])

  // Cada idioma lembra a própria voz.
  useEffect(() => setVozURI(ler(chaveVoz(idiomaAtivo))), [idiomaAtivo])

  // ── Idioma do texto ───────────────────────────────────────────────────
  // Descoberto sozinho a cada mudança do texto — digitado, colado, aberto de
  // um arquivo ou reconhecido numa foto, tanto faz. A espera evita refazer a
  // conta a cada tecla. Quem escolheu o idioma à mão fica de fora disto.
  useEffect(() => {
    if (origemManual !== null) return
    const espera = window.setTimeout(() => {
      const descoberto = detectarIdioma(texto)
      setDetectado(descoberto)
      if (descoberto) setIdioma(descoberto)
    }, 300)
    return () => window.clearTimeout(espera)
  }, [texto, origemManual])

  // ── Voz natural ───────────────────────────────────────────────────────
  // O modelo deste idioma já está guardado neste navegador?
  useEffect(() => {
    let valendo = true
    setBaixada(false)
    if (!naturalDoIdioma) return
    void jaBaixadas().then((lista) => {
      if (valendo) setBaixada(lista.includes(naturalDoIdioma.id))
    })
    return () => {
      valendo = false
    }
  }, [naturalDoIdioma])

  /** Baixa o modelo de voz deste idioma (uma vez por aparelho). */
  const baixarVoz = useCallback(async () => {
    if (!naturalDoIdioma) return
    const controle = new AbortController()
    baixadorRef.current = controle
    setBaixando({ etapa: 'ajustes', baixados: 0, total: 0 })
    setFalhaDaVoz(null)
    setVerDetalhe(false)
    esquecerFalha()
    setRecado(null)
    try {
      await baixar(naturalDoIdioma.id, (andamento) => setBaixando(andamento), controle.signal)
      setBaixada(true)
      setFonte('natural')
    } catch (erro) {
      if (controle.signal.aborted) return
      // A explicação vem pronta de `vozNatural.ts`, que sabe qual arquivo
      // falhou e por quê. O detalhe técnico fica guardado para quem quiser ver.
      setFalhaDaVoz(
        erro instanceof ErroDeVoz
          ? { mensagem: erro.message, detalhe: erro.detalhe }
          : { mensagem: 'Não foi possível preparar a voz natural.', detalhe: String(erro) },
      )
      if (erro instanceof ErroDeVoz && erro.detalhe) console.warn('[voz natural]', erro.detalhe)
    } finally {
      baixadorRef.current = null
      setBaixando(null)
    }
  }, [naturalDoIdioma])

  /** Desiste do download sem mexer no texto nem na leitura. */
  const cancelarDownload = useCallback(() => {
    baixadorRef.current?.abort()
    baixadorRef.current = null
    setBaixando(null)
  }, [])

  // Trocar de motor no meio da leitura deixaria a voz antiga falando sozinha.
  const motorAnterior = useRef(usandoNatural)
  /** Onde a leitura estava quando a troca de voz foi pedida. */
  const retomarNaTroca = useRef<number | null>(null)

  useEffect(() => {
    if (motorAnterior.current === usandoNatural) return
    motorAnterior.current = usandoNatural
    doAparelho.parar()
    daNatural.parar()

    // Quem trocou de voz no meio da leitura continua de onde estava.
    const ponto = retomarNaTroca.current
    retomarNaTroca.current = null
    if (ponto !== null) (usandoNatural ? daNatural : doAparelho).iniciar(ponto)
  }, [usandoNatural, doAparelho, daNatural])

  /** Sai da voz natural sem perder o ponto, a velocidade nem o idioma. */
  const usarVozDoAparelho = useCallback(() => {
    retomarNaTroca.current = posicao
    setFonte('aparelho')
  }, [posicao])

  // ── Ajustes no meio da leitura ────────────────────────────────────────
  const primeiro = useRef(true)
  useEffect(() => {
    if (primeiro.current) {
      primeiro.current = false
      return
    }
    // Na voz natural a velocidade é só a rotação do áudio, que o próprio
    // motor ajusta; refazer a fala seria um solavanco à toa.
    if (usandoNatural) return
    // A espera evita recomeçar a fala a cada passo do controle de velocidade.
    const relogio = window.setTimeout(reiniciar, ESPERA_AJUSTE)
    return () => window.clearTimeout(relogio)
  }, [voz, velocidade, idiomaAtivo, reiniciar, usandoNatural])

  // ── Acompanhar a leitura na tela ──────────────────────────────────────
  /** Quando a área do texto rolou pela última vez. */
  const ultimaRolagem = useRef(0)

  /**
   * Toda rolagem que a página faz sozinha passa por aqui — é o que permite
   * distinguir depois a rolagem da pessoa da nossa.
   */
  const rolarSozinho = useCallback((area: HTMLElement, deslocamento: number) => {
    rolagemNossa.current = Date.now() + MARGEM_DA_ROLAGEM
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    area.scrollBy({ top: deslocamento, behavior: suave ? 'smooth' : 'auto' })
  }, [])

  useEffect(() => {
    const area = areaRef.current
    if (!area || !ativo || !acompanhando) return
    const alvo =
      area.querySelector<HTMLElement>('[data-ativa="1"]') ?? area.querySelector<HTMLElement>('.frase--ativa')
    if (!alvo) return

    // Só a área do texto rola; a conta é toda dentro dela.
    const caixa = alvo.getBoundingClientRect()
    const janela = area.getBoundingClientRect()
    // Numa tela baixa a área do texto é curta: a folga encolhe junto, senão
    // não sobra lugar nenhum onde o trecho pudesse caber.
    const folga = Math.min(FOLGA_ROLAGEM, janela.height / 4)
    if (caixa.top >= janela.top + folga && caixa.bottom <= janela.bottom - folga) return

    // Um pedido novo no meio da animação anterior a reinicia, e com palavras
    // em sequência a rolagem nunca sairia do lugar. Daí o intervalo mínimo.
    const agora = Date.now()
    if (agora - ultimaRolagem.current < ESPERA_ROLAGEM) return
    ultimaRolagem.current = agora

    // Deixa o trecho lido no meio da área visível.
    rolarSozinho(area, caixa.top - janela.top - (janela.height - caixa.height) / 2)
  }, [destaque, indice, ativo, acompanhando, rolarSozinho])

  /**
   * Rolar à mão solta a tela: a leitura segue, o destaque segue, mas a página
   * fica onde a pessoa deixou até ela pedir para voltar.
   *
   * Vale para os **dois** painéis — o que está sendo lido e o da outra versão,
   * ao lado — e para qualquer jeito de rolar: dedo, roda do mouse, teclado ou
   * a barra de rolagem arrastada com o ponteiro. Os dois últimos só disparam
   * `scroll`, o mesmo evento da rolagem automática; por isso a janela de tempo.
   */
  useEffect(() => {
    const lida = areaRef.current
    const outra = comparacaoRef.current
    const paineis: [HTMLElement, Versao][] = []
    if (lida) paineis.push([lida, versao])
    if (outra) paineis.push([outra, aOutra(versao)])
    if (paineis.length === 0) return

    const soltar = () => setAcompanhando(false)
    const limpezas = paineis.map(([painel, qual]) => {
      const aoRolar = () => {
        // Guarda onde este painel ficou, para a volta à aba.
        posicoes.current[qual] = painel.scrollTop
        if (Date.now() > rolagemNossa.current) setAcompanhando(false)
      }
      painel.addEventListener('wheel', soltar, { passive: true })
      painel.addEventListener('touchmove', soltar, { passive: true })
      painel.addEventListener('scroll', aoRolar, { passive: true })
      return () => {
        painel.removeEventListener('wheel', soltar)
        painel.removeEventListener('touchmove', soltar)
        painel.removeEventListener('scroll', aoRolar)
      }
    })
    return () => limpezas.forEach((limpar) => limpar())
  }, [editando, versao, traducao])

  /**
   * Trocar de versão devolve cada painel ao ponto em que foi deixado — no
   * celular, onde as duas viram abas, é o que faz cada aba voltar ao lugar.
   */
  useLayoutEffect(() => {
    rolagemNossa.current = Date.now() + MARGEM_DA_ROLAGEM
    if (areaRef.current) areaRef.current.scrollTop = posicoes.current[versao]
    if (comparacaoRef.current) comparacaoRef.current.scrollTop = posicoes.current[aOutra(versao)]
  }, [versao, traducao, editando])

  /** Leva a tela de volta ao trecho em leitura e volta a acompanhar. */
  const voltarAoTrecho = useCallback(() => {
    setAcompanhando(true)
    const area = areaRef.current
    const alvo =
      area?.querySelector<HTMLElement>('[data-ativa="1"]') ?? area?.querySelector<HTMLElement>('.frase--ativa')
    if (!area || !alvo) return
    const caixa = alvo.getBoundingClientRect()
    const janela = area.getBoundingClientRect()
    rolarSozinho(area, caixa.top - janela.top - (janela.height - caixa.height) / 2)
  }, [rolarSozinho])

  // ── Ações ─────────────────────────────────────────────────────────────
  const comecar = useCallback(() => {
    if (semTexto) return
    setEditando(false)
    setRecado(null)
    setAcompanhando(true)
    iniciar(trechos[0].inicio)
  }, [iniciar, semTexto, trechos])

  const alternar = useCallback(() => {
    if (estado === 'lendo') pausar()
    else if (estado === 'pausado') continuar()
    else comecar()
  }, [comecar, continuar, estado, pausar])

  /** Cancela o reconhecimento ou a tradução em andamento. */
  const cancelarTarefa = useCallback(() => {
    cancelador.current?.abort()
    cancelador.current = null
    setTarefa(null)
  }, [])

  const editar = useCallback(() => {
    parar()
    setEditando(true)
    window.setTimeout(() => campoRef.current?.focus(), 0)
  }, [parar])

  const limpar = useCallback(() => {
    parar()
    cancelarTarefa()
    setTexto('')
    setTraducao(null)
    setVersao('original')
    setArquivo(null)
    setEditando(true)
    setRecado(null)
    esquecerPosicoes()
  }, [cancelarTarefa, esquecerPosicoes, parar])

  /**
   * Põe um texto novo em leitura. A tradução antiga não vale mais, e o idioma
   * é adivinhado — quem discordar corrige nos botões PT/EN/ES/DE.
   */
  const aplicarTexto = useCallback(
    (novo: string, nomeDoArquivo: string | null) => {
      setTexto(novo)
      setTraducao(null)
      setVersao('original')
      setArquivo(nomeDoArquivo)
      setEditando(false)
      esquecerPosicoes()
      const descoberto = detectarIdioma(novo)
      setDetectado(descoberto)
      // Quem escolheu o idioma à mão manda mais que a descoberta automática.
      if (descoberto && origemManual === null) setIdioma(descoberto)
    },
    [esquecerPosicoes, origemManual],
  )

  /** Troca o idioma do original (pelos botões ou pela lista da tradução). */
  const escolherOrigem = useCallback(
    (codigo: string | null) => {
      setOrigemManual(codigo)
      if (codigo) {
        setIdioma(codigo)
        return
      }
      // Voltou para "detectar automaticamente": vale refazer a descoberta.
      const descoberto = detectarIdioma(texto)
      setDetectado(descoberto)
      if (descoberto) setIdioma(descoberto)
    },
    [texto],
  )

  /** Abre um PDF, Word, texto — ou reconhece as palavras de uma imagem. */
  const abrirArquivo = useCallback(
    async (escolhido: File) => {
      parar()
      cancelarTarefa()
      setAbrindo(true)
      setRecado(null)

      const controle = new AbortController()
      cancelador.current = controle

      try {
        const lido = await extrairTexto(escolhido)
        let texto = lido.texto
        let etiqueta = lido.paginas
          ? `${lido.nome} · ${lido.paginas} ${lido.paginas === 1 ? 'página' : 'páginas'}`
          : lido.nome

        // Foto com palavras: reconhecimento de texto.
        if (lido.precisaOcr === 'imagem') {
          if (!(await navegadorAbreImagem(escolhido))) {
            throw new ErroDeArquivo(
              ehHeic(escolhido.name, escolhido.type)
                ? 'Este navegador não abre fotos HEIC do iPhone. No iPhone, vá em Ajustes → Câmera → Formatos e ' +
                  'escolha "Mais compatível", ou compartilhe a foto como JPEG antes de abrir aqui.'
                : 'O navegador não conseguiu abrir esta imagem.',
            )
          }
          setAbrindo(false)
          setTarefa({ nome: 'Reconhecendo o texto da imagem', etapa: 'Preparando…', fracao: 0 })
          texto = await reconhecerImagem(
            escolhido,
            idioma,
            ({ fracao, etapa }) => setTarefa({ nome: 'Reconhecendo o texto da imagem', etapa, fracao }),
            controle.signal,
          )
          etiqueta = `${lido.nome} · texto reconhecido`
        }

        // PDF digitalizado: cada página vira imagem e passa pelo mesmo caminho.
        if (lido.precisaOcr === 'pdf') {
          setAbrindo(false)
          setTarefa({ nome: 'PDF digitalizado', etapa: 'Preparando as páginas…', fracao: 0 })
          const imagens = await paginasComoImagens(
            escolhido,
            (fracao, pagina, total) =>
              setTarefa({
                nome: 'PDF digitalizado',
                etapa: `Preparando a página ${pagina} de ${total}…`,
                fracao: fracao * 0.2,
              }),
            controle.signal,
          )
          if (controle.signal.aborted) throw new ErroDeOcr('Reconhecimento cancelado.')
          texto = await reconhecerPaginas(
            imagens,
            idioma,
            ({ fracao, etapa }) => setTarefa({ nome: 'PDF digitalizado', etapa, fracao: 0.2 + fracao * 0.8 }),
            controle.signal,
          )
          const limite = (lido.paginas ?? 0) > MAXIMO_DE_PAGINAS_OCR ? ` (as primeiras ${MAXIMO_DE_PAGINAS_OCR})` : ''
          etiqueta = `${lido.nome} · ${imagens.length} ${imagens.length === 1 ? 'página' : 'páginas'} reconhecidas${limite}`
        }

        if (texto.trim().length === 0) {
          throw new ErroDeArquivo(
            lido.precisaOcr
              ? 'Não encontrei palavras legíveis nesta imagem. Tente uma foto mais nítida, bem iluminada e sem inclinação.'
              : 'O arquivo foi aberto, mas não tem texto para ler.',
          )
        }
        aplicarTexto(texto, etiqueta)
      } catch (erro) {
        const conhecido = erro instanceof ErroDeArquivo || erro instanceof ErroDeOcr
        setRecado(conhecido ? erro.message : 'Não foi possível abrir este arquivo.')
      } finally {
        cancelador.current = null
        setTarefa(null)
        setAbrindo(false)
      }
    },
    [aplicarTexto, cancelarTarefa, idioma, parar],
  )

  // ── Tradução ──────────────────────────────────────────────────────────
  /** Traduz o texto inteiro, parágrafo a parágrafo, sem tocar no original. */
  const traduzir = useCallback(
    async (para: string) => {
      const paragrafos = emParagrafos(texto)
      if (paragrafos.length === 0) return
      parar()
      cancelarTarefa()
      setRecado(null)

      const controle = new AbortController()
      cancelador.current = controle
      setTarefa({ nome: 'Traduzindo', etapa: 'Começando…', fracao: 0 })

      try {
        const traduzidos = await traduzirParagrafos(
          paragrafos,
          idioma,
          para,
          ({ fracao, paragrafo, total }) =>
            setTarefa({ nome: 'Traduzindo', etapa: `Parágrafo ${paragrafo} de ${total}`, fracao }),
          controle.signal,
        )
        // O original nunca é tocado: a tradução vive ao lado dele.
        // Tradução nova: ela ainda não foi lida por ninguém, começa do topo.
        posicoes.current.traducao = 0
        setTraducao({ de: idioma, para, texto: traduzidos.join('\n') })
        setVersao('traducao')
        setDestino(para)
        setTraducaoAberta(true)
      } catch (erro) {
        setRecado(erro instanceof ErroDeTraducao ? erro.message : 'Não foi possível traduzir o texto.')
      } finally {
        cancelador.current = null
        setTarefa(null)
      }
    },
    [cancelarTarefa, idioma, parar, texto],
  )

  /** Alterna entre original e tradução, encerrando a leitura em curso. */
  const trocarVersao = useCallback(
    (qual: Versao) => {
      if (qual === versao) return
      parar()
      setVersao(qual)
      // O acompanhamento não volta sozinho: cada aba retoma no ponto em que
      // foi deixada, e quem manda a tela seguir a leitura é o botão
      // "Voltar ao trecho atual" ou um clique num trecho.
    },
    [parar, versao],
  )

  /**
   * "Ouvir original" e "Ouvir tradução".
   *
   * Trocar de versão troca o texto, as frases e a voz — tudo isso só existe no
   * próximo desenho da tela. Por isso o pedido fica anotado aqui e a leitura
   * começa no efeito abaixo, já com a versão certa no lugar.
   */
  const pedidoDeLeitura = useRef(false)
  const ouvirVersao = useCallback(
    (qual: Versao) => {
      setEditando(false)
      setAcompanhando(true)
      // Já é esta a versão à vista: basta ler do começo dela.
      if (qual === versao) {
        if (trechos.length > 0) iniciar(trechos[0].inicio)
        return
      }
      parar()
      setVersao(qual)
      pedidoDeLeitura.current = true
    },
    [iniciar, parar, trechos, versao],
  )

  useEffect(() => {
    if (!pedidoDeLeitura.current) return
    pedidoDeLeitura.current = false
    if (trechos.length > 0) iniciar(trechos[0].inicio)
  }, [versao, trechos, iniciar])

  // Traduzir para o mesmo idioma não faz sentido: o destino se afasta sozinho.
  useEffect(() => {
    if (destino === idioma) {
      const outro = IDIOMAS.find((item) => item.codigo !== idioma)
      if (outro) setDestino(outro.codigo)
    }
  }, [destino, idioma])

  // ── Google Drive ──────────────────────────────────────────────────────
  // A conta conectada é lembrada entre visitas; a tela acompanha as mudanças.
  useEffect(() => drive.aoMudarSessao(setContaDrive), [])

  const falarDoDrive = useCallback((erro: unknown) => {
    setRecado(erro instanceof drive.ErroDoDrive ? erro.message : 'Não foi possível falar com o Google Drive.')
  }, [])

  /** Abre a janela do Google para escolher um arquivo e o carrega. */
  const escolherNoDrive = useCallback(async () => {
    setRecado(null)
    setAbrindo(true)
    try {
      const escolhido = await drive.escolherArquivo()
      if (!escolhido) return
      const baixado = await drive.baixarArquivo(escolhido)
      setAbrindo(false)
      // Daqui para a frente é o mesmo caminho de um arquivo do computador.
      await abrirArquivo(baixado)
    } catch (erro) {
      falarDoDrive(erro)
    } finally {
      setAbrindo(false)
    }
  }, [abrirArquivo, falarDoDrive])

  /** Um toque só: entra na conta (se precisar) e já abre o seletor. */
  const abrirDoDrive = useCallback(async () => {
    setRecado(null)
    setConectandoDrive(true)
    try {
      await drive.conectar()
    } catch (erro) {
      falarDoDrive(erro)
      return
    } finally {
      setConectandoDrive(false)
    }
    await escolherNoDrive()
  }, [escolherNoDrive, falarDoDrive])

  const trocarContaDoDrive = useCallback(async () => {
    setRecado(null)
    setConectandoDrive(true)
    try {
      await drive.trocarConta()
    } catch (erro) {
      falarDoDrive(erro)
    } finally {
      setConectandoDrive(false)
    }
  }, [falarDoDrive])

  const desconectarDoDrive = useCallback(async () => {
    setRecado(null)
    await drive.desconectar()
  }, [])

  const soltarArquivo = useCallback(
    (evento: DragEvent<HTMLElement>) => {
      evento.preventDefault()
      setArrastando(false)
      const escolhido = evento.dataTransfer.files[0]
      if (escolhido) void abrirArquivo(escolhido)
    },
    [abrirArquivo],
  )

  const usarExemplo = useCallback(() => {
    parar()
    setTexto(idiomaAtual.exemplo)
    setTraducao(null)
    setVersao('original')
    setArquivo(null)
    setEditando(false)
    setRecado(null)
    esquecerPosicoes()
  }, [esquecerPosicoes, idiomaAtual, parar])

  const colar = useCallback(async () => {
    try {
      const conteudo = await navigator.clipboard.readText()
      if (conteudo.trim().length === 0) {
        setRecado('Não há texto na área de transferência.')
        return
      }
      parar()
      aplicarTexto(conteudo, null)
    } catch {
      setRecado('O navegador não liberou a área de transferência. Cole com Ctrl+V (ou ⌘+V) no campo de texto.')
    }
  }, [aplicarTexto, parar])

  /** Um clique numa palavra continua a leitura a partir dela. */
  const clicarNoTexto = useCallback(
    (evento: MouseEvent<HTMLDivElement>) => {
      const alvo = (evento.target as HTMLElement).closest('[data-pos]')
      if (!alvo) return
      const pos = Number(alvo.getAttribute('data-pos'))
      if (!Number.isFinite(pos)) return
      // Escolher um trecho novo também é pedir a tela de volta.
      setAcompanhando(true)
      iniciar(pos)
    },
    [iniciar],
  )

  // Um arquivo solto fora do cartão não deve substituir a página.
  useEffect(() => {
    const impedir = (evento: globalThis.DragEvent) => evento.preventDefault()
    window.addEventListener('dragover', impedir)
    window.addEventListener('drop', impedir)
    return () => {
      window.removeEventListener('dragover', impedir)
      window.removeEventListener('drop', impedir)
    }
  }, [])

  // ── Atalhos ───────────────────────────────────────────────────────────
  useEffect(() => {
    const aoTeclar = (evento: KeyboardEvent) => {
      const alvo = evento.target as HTMLElement | null
      if (alvo && (alvo.tagName === 'TEXTAREA' || alvo.tagName === 'INPUT' || alvo.isContentEditable)) return
      if (evento.code === 'Space') {
        evento.preventDefault()
        alternar()
      } else if (evento.key === 'Escape') {
        parar()
      }
    }
    window.addEventListener('keydown', aoTeclar)
    return () => window.removeEventListener('keydown', aoTeclar)
  }, [alternar, parar])

  const semVoz = vozes.length > 0 && disponiveis.length === 0
  const aviso = !TEM_VOZ
    ? 'Este navegador não tem leitura em voz alta. Tente o Chrome, o Edge ou o Safari mais recentes.'
    : semVoz
      ? `Nenhuma voz de ${idiomaAtual.nome} está instalada neste aparelho. Escolha outro idioma ou instale a voz nas configurações do sistema.`
      : (leitura.erro ?? falhaDaVoz?.mensagem ?? recado)

  return (
    <div className="leitor">
      <header className="leitor__topo">
        <div className="leitor__marca">
          <span className="leitor__mark">
            <IconSpeaker size={19} />
          </span>
          <span>
            <strong className="leitor__nome">Leitura em voz alta</strong>
            <span className="leitor__tag">Português · English · Español · Deutsch</span>
          </span>
        </div>
      </header>

      <main className="leitor__corpo">
        <section
          className={arrastando ? 'cartao cartao--texto cartao--soltar' : 'cartao cartao--texto'}
          onDragOver={(evento) => {
            evento.preventDefault()
            setArrastando(true)
          }}
          onDragLeave={(evento) => {
            if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) setArrastando(false)
          }}
          onDrop={soltarArquivo}
        >
          {arrastando ? (
            <div className="soltar-aqui">
              <IconUpload size={26} />
              <p>Solte o arquivo para abrir</p>
              <span>PDF, Word (.docx), OpenDocument (.odt) ou texto</span>
            </div>
          ) : null}
          <div className="cartao__topo">
            <h2 className="cartao__titulo">{editando ? 'Escreva ou cole o texto' : 'Texto'}</h2>
            <div className="cartao__acoes">
              {editando ? (
                <button
                  type="button"
                  className="btn btn--sm btn--accent"
                  onClick={() => setEditando(false)}
                  disabled={semTexto}
                >
                  Pronto
                </button>
              ) : (
                <button type="button" className="btn btn--sm" onClick={editar}>
                  <IconPencil size={14} /> Editar
                </button>
              )}
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => seletorRef.current?.click()}
                disabled={abrindo}
              >
                {abrindo ? <IconSpinner size={14} className="spin" /> : <IconUpload size={14} />} Arquivo
              </button>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => void abrirDoDrive()}
                disabled={abrindo || conectandoDrive}
                title={contaDrive ? `Abrir um arquivo do Drive de ${contaDrive.conta ?? 'sua conta'}` : 'Conectar ao Google Drive'}
              >
                <IconNuvem size={14} />{' '}
                <span className="btn__texto">{contaDrive ? 'Drive' : 'Conectar ao Drive'}</span>
              </button>
              <button
                type="button"
                className={traducaoAberta ? 'btn btn--sm btn--accent' : 'btn btn--sm'}
                onClick={() => setTraducaoAberta((aberta) => !aberta)}
                disabled={semTexto}
                aria-expanded={traducaoAberta}
                title="Escolher os idiomas e traduzir"
              >
                <IconTraduzir size={14} /> <span className="btn__texto">Traduzir</span>
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={colar} aria-label="Colar">
                <IconClipboard size={14} /> <span className="btn__texto">Colar</span>
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={usarExemplo} aria-label="Exemplo">
                <IconWand size={14} /> <span className="btn__texto">Exemplo</span>
              </button>
              <button
                type="button"
                className="btn btn--sm btn--ghost"
                onClick={limpar}
                disabled={texto.length === 0}
                aria-label="Limpar o texto"
              >
                <IconTrash size={14} />
              </button>
            </div>
          </div>

          {/* Tradução: os dois idiomas e o botão, à vista enquanto o painel
              estiver aberto — e sempre que já houver uma tradução. */}
          {!editando && !semTexto && (traducaoAberta || traducao) ? (
            <div className="traducao-barra">
              <div className="traducao-barra__linha">
                <label className="traducao-campo">
                  <span className="field__label">Idioma original</span>
                  <select
                    className="text-input select"
                    value={origemManual ?? 'auto'}
                    onChange={(evento) =>
                      escolherOrigem(evento.target.value === 'auto' ? null : evento.target.value)
                    }
                  >
                    <option value="auto">
                      Detectar automaticamente
                      {origemManual === null && detectado ? ` · ${idiomaPorCodigo(detectado).nome}` : ''}
                    </option>
                    {IDIOMAS.map((item) => (
                      <option key={item.codigo} value={item.codigo}>
                        {item.nome}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="traducao-campo">
                  <span className="field__label">Traduzir para</span>
                  <select
                    className="text-input select"
                    value={destino}
                    onChange={(evento) => setDestino(evento.target.value)}
                  >
                    {/* O destino nunca pode ser o mesmo idioma do original. */}
                    {IDIOMAS.filter((item) => item.codigo !== idioma).map((item) => (
                      <option key={item.codigo} value={item.codigo}>
                        {item.nome}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className="btn btn--accent traducao-barra__botao"
                  onClick={() => void traduzir(destino)}
                  disabled={tarefa !== null || destino === idioma}
                >
                  <IconTraduzir size={15} /> Traduzir
                </button>
              </div>

              <p className="traducao-barra__nota">
                {origemManual === null
                  ? detectado
                    ? `Idioma identificado no texto: ${idiomaPorCodigo(detectado).nome}. Se estiver errado, escolha o certo na lista.`
                    : 'Não deu para identificar o idioma sozinho — escolha o idioma original na lista.'
                  : `Idioma original escolhido por você: ${idiomaPorCodigo(idioma).nome}.`}
              </p>

              {traducao ? (
                <div className="traducao-barra__linha">
                  <div className="abas" role="group" aria-label="Versão do texto">
                    <button
                      type="button"
                      className={mostrandoTraducao ? 'abas__item' : 'abas__item abas__item--on'}
                      onClick={() => trocarVersao('original')}
                      aria-pressed={!mostrandoTraducao}
                    >
                      Original · {idiomaPorCodigo(traducao.de).sigla}
                    </button>
                    <button
                      type="button"
                      className={mostrandoTraducao ? 'abas__item abas__item--on' : 'abas__item'}
                      onClick={() => trocarVersao('traducao')}
                      aria-pressed={mostrandoTraducao}
                    >
                      Tradução · {idiomaPorCodigo(traducao.para).sigla}
                    </button>
                  </div>

                  {/* Uma versão de cada vez: quem começa, encerra a anterior. */}
                  <button type="button" className="btn btn--sm" onClick={() => ouvirVersao('original')}>
                    <IconPlay size={13} /> Ouvir original
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => ouvirVersao('traducao')}>
                    <IconPlay size={13} /> Ouvir tradução
                  </button>
                </div>
              ) : null}

              {tarefa ? (
                <div className="tarefa">
                  <span className="tarefa__nome">
                    {tarefa.nome}: {tarefa.etapa}
                  </span>
                  <div className="transporte__trilha" aria-hidden="true">
                    <div className="transporte__preenchimento" style={{ width: `${tarefa.fracao * 100}%` }} />
                  </div>
                  <button type="button" className="btn btn--sm btn--danger" onClick={cancelarTarefa}>
                    Cancelar
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          <input
            ref={seletorRef}
            type="file"
            className="visually-hidden"
            accept={TIPOS_ACEITOS}
            onChange={(evento) => {
              const escolhido = evento.target.files?.[0]
              // Zera o campo para que o mesmo arquivo possa ser aberto de novo.
              evento.target.value = ''
              if (escolhido) void abrirArquivo(escolhido)
            }}
          />

          {abrindo ? (
            <div className="carregando">
              <IconSpinner size={22} className="spin" />
              <p>Abrindo o arquivo e extraindo o texto…</p>
            </div>
          ) : tarefa ? (
            <div className="carregando">
              <IconSpinner size={22} className="spin" />
              <p>
                {tarefa.nome}: {tarefa.etapa}
              </p>
              <p className="carregando__dica">{Math.round(tarefa.fracao * 100)}% — dá para cancelar acima.</p>
            </div>
          ) : editando ? (
            <textarea
              ref={campoRef}
              className="campo-texto"
              value={textoAtivo}
              onChange={(evento) => {
                const novo = evento.target.value
                // Editando a tradução, o original fica intacto — e vice-versa.
                if (mostrandoTraducao && traducao) setTraducao({ ...traducao, texto: novo })
                else {
                  setTexto(novo)
                  setArquivo(null)
                }
              }}
              placeholder={
                'Cole aqui o texto que você quer ouvir — ou toque em Arquivo para abrir um PDF, um Word (.docx) ou um .txt.\n\n' +
                'Depois escolha o idioma, a voz e a velocidade e toque em Iniciar.'
              }
              spellCheck={false}
              autoFocus
            />
          ) : (
            <>
              {ativo && !acompanhando ? (
                <button type="button" className="voltar-ao-trecho" onClick={voltarAoTrecho}>
                  <IconArrowDown size={14} /> Voltar ao trecho atual
                </button>
              ) : null}

              <div className={traducao ? 'painel-duplo' : 'painel-duplo painel-duplo--so-um'}>
              <div className={traducao ? 'leitura leitura--lado-a-lado' : 'leitura'} ref={areaRef} onClick={clicarNoTexto}>
                {paragrafos.map((grupo) => (
                  <p className="leitura__paragrafo" key={grupo[0].inicio}>
                    {grupo.map((trecho, ordem) => (
                      <Fragment key={trecho.inicio}>
                        {ordem > 0 ? ' ' : null}
                        <Frase
                          trecho={trecho}
                          ativa={trecho.indice === indice}
                          destaque={trecho.indice === indice ? (destaque?.inicio ?? -1) : -1}
                        />
                      </Fragment>
                    ))}
                  </p>
                ))}
              </div>

              {/* No computador, a outra versão fica ao lado para comparar. */}
              {traducao ? (
                <div
                  className="comparacao"
                  ref={comparacaoRef}
                  aria-label={mostrandoTraducao ? 'Texto original' : 'Tradução'}
                >
                  <p className="comparacao__titulo">
                    {mostrandoTraducao
                      ? `Original · ${idiomaPorCodigo(traducao.de).nome}`
                      : `Tradução · ${idiomaPorCodigo(traducao.para).nome}`}
                  </p>
                  {emParagrafos(mostrandoTraducao ? texto : traducao.texto).map((paragrafo, ordem) => (
                    <p className="comparacao__paragrafo" key={ordem}>
                      {paragrafo}
                    </p>
                  ))}
                </div>
              ) : null}
              </div>
            </>
          )}

          <div className="cartao__rodape">
            {arquivo ? (
              <span className="cartao__arquivo" title={arquivo}>
                <IconUpload size={12} /> {arquivo}
              </span>
            ) : null}
            <span>
              {palavras} {palavras === 1 ? 'palavra' : 'palavras'} · {trechos.length}{' '}
              {trechos.length === 1 ? 'frase' : 'frases'}
            </span>
            <span className="mono">≈ {formatDuration(estimarSegundos(palavras, velocidade))}</span>
          </div>
        </section>

        <aside className="cartao cartao--ajustes">
          <div className="ajuste ajuste--idioma">
            <span className="field__label">Idioma</span>
            <div className="segmentado" role="group" aria-label="Idioma do texto">
              {IDIOMAS.map((item) => (
                <button
                  key={item.codigo}
                  type="button"
                  className={item.codigo === idioma ? 'segmentado__item segmentado__item--on' : 'segmentado__item'}
                  onClick={() => escolherOrigem(item.codigo)}
                  aria-pressed={item.codigo === idioma}
                >
                  <strong>{item.sigla}</strong>
                  <span>{item.nome}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="ajuste ajuste--voz">
            <label className="field__label" htmlFor="voz">
              Voz
            </label>

            {temNatural ? (
              <div className="fonte" role="group" aria-label="De onde vem a voz">
                <button
                  type="button"
                  className={usandoNatural ? 'fonte__item' : 'fonte__item fonte__item--on'}
                  onClick={() => setFonte('aparelho')}
                  aria-pressed={!usandoNatural}
                >
                  Do aparelho
                </button>
                <button
                  type="button"
                  className={usandoNatural ? 'fonte__item fonte__item--on' : 'fonte__item'}
                  onClick={() => (baixada ? setFonte('natural') : void baixarVoz())}
                  aria-pressed={usandoNatural}
                  disabled={baixando !== null}
                >
                  {baixando !== null
                    ? 'Preparando…'
                    : baixada
                      ? 'Natural'
                      : `Natural · ${naturalDoIdioma?.tamanhoMB} MB`}
                </button>
              </div>
            ) : null}

            {/* Andamento de verdade: quantos MB já vieram, de quantos. */}
            {baixando !== null ? (
              <div className="download">
                <span className="download__texto">{recadoDoDownload(baixando)}</span>
                <div className="transporte__trilha" aria-hidden="true">
                  <div
                    className="transporte__preenchimento"
                    style={{ width: `${baixando.total > 0 ? (baixando.baixados / baixando.total) * 100 : 4}%` }}
                  />
                </div>
                <button type="button" className="btn btn--sm btn--ghost" onClick={cancelarDownload}>
                  Cancelar
                </button>
              </div>
            ) : null}

            <select
              id="voz"
              className="text-input select"
              value={usandoNatural ? '' : (voz?.voiceURI ?? '')}
              onChange={(evento) => {
                // Escolha da pessoa: fica guardada para as próximas visitas.
                setVozURI(evento.target.value)
                salvar(chaveVoz(idioma), evento.target.value)
              }}
              disabled={disponiveis.length === 0 || usandoNatural}
            >
              {usandoNatural ? (
                <option value="">{naturalDoIdioma?.nome}</option>
              ) : disponiveis.length === 0 ? (
                <option value="">Nenhuma voz disponível</option>
              ) : (
                disponiveis.map((item) => (
                  <option key={item.voiceURI} value={item.voiceURI}>
                    {item.name}
                    {item.localService ? '' : ' · online'}
                  </option>
                ))
              )}
            </select>
            <p className="field__hint">
              {usandoNatural
                ? 'Voz baixada no aparelho: funciona igual em qualquer celular ou computador, sem internet e sem custo.'
                : temNatural && !baixada
                  ? `A voz natural baixa ${naturalDoIdioma?.tamanhoMB} MB uma vez e depois funciona offline — vale a pena onde as vozes do aparelho soam mecânicas, como no iPhone.`
                  : disponiveis.length > 0
                    ? `${disponiveis.length} ${disponiveis.length === 1 ? 'voz instalada' : 'vozes instaladas'} para ${idiomaAtual.nome}.`
                    : 'As vozes vêm do sistema operacional.'}
            </p>
          </div>

          <div className="ajuste ajuste--velocidade">
            <div className="field__head">
              <label className="field__label" htmlFor="velocidade">
                Velocidade
              </label>
              <span className="field__value">{velocidade.toFixed(2)}×</span>
            </div>
            <input
              id="velocidade"
              type="range"
              min={VELOCIDADE_MIN}
              max={VELOCIDADE_MAX}
              step={0.05}
              value={velocidade}
              onChange={(evento) => setVelocidade(limitarVelocidade(Number(evento.target.value)))}
              style={
                {
                  '--fill': `${((velocidade - VELOCIDADE_MIN) / (VELOCIDADE_MAX - VELOCIDADE_MIN)) * 100}%`,
                } as CSSProperties
              }
            />
            <div className="ajuste__atalhos">
              {[0.75, VELOCIDADE_PADRAO, 1.25, 1.5].map((valor) => (
                <button
                  key={valor}
                  type="button"
                  className={valor === velocidade ? 'chip chip--on' : 'chip'}
                  onClick={() => setVelocidade(valor)}
                >
                  {valor}×
                </button>
              ))}
            </div>
          </div>

          <div className="ajuste ajuste--drive">
            <span className="field__label">Google Drive</span>
            {!drive.configurado() ? (
              <p className="field__hint">
                O Google Drive ainda não foi ligado nesta publicação. Quem cuida do projeto precisa cadastrar o ID
                do cliente OAuth uma única vez — o passo a passo está no LEIA-ME. Enquanto isso, use o botão
                <strong> Arquivo</strong>.
              </p>
            ) : contaDrive ? (
              <>
                <p className="drive__conta">
                  Conectado como <strong>{contaDrive.conta ?? 'sua conta do Google'}</strong>
                </p>
                <div className="drive__acoes">
                  <button
                    type="button"
                    className="btn btn--sm btn--accent"
                    onClick={() => void escolherNoDrive()}
                    disabled={abrindo || conectandoDrive}
                  >
                    <IconNuvem size={13} /> Abrir arquivo
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void trocarContaDoDrive()}
                    disabled={conectandoDrive}
                  >
                    Trocar de conta
                  </button>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => void desconectarDoDrive()}>
                    Desconectar
                  </button>
                </div>
                <p className="field__hint">
                  O programa só enxerga os arquivos que você escolher na janela do Google.
                </p>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn--sm btn--accent"
                  onClick={() => void abrirDoDrive()}
                  disabled={conectandoDrive}
                >
                  {conectandoDrive ? <IconSpinner size={13} className="spin" /> : <IconNuvem size={13} />} Conectar ao
                  Google Drive
                </button>
                <p className="field__hint">
                  Entre pela tela do próprio Google. A permissão pedida vale só para os arquivos que você escolher.
                </p>
              </>
            )}
          </div>

          <p className="ajuste__dica">
            Durante a leitura, clique em qualquer palavra do texto para continuar a partir dali — o trecho falado fica
            destacado. Você também pode arrastar um PDF, um Word (.docx) ou um .txt para cima do texto.
          </p>
        </aside>
      </main>

      {aviso ? (
        <div className="leitor__aviso" role="status">
          <IconAlert size={15} />
          <span>{aviso}</span>

          {/* Falhou no meio da leitura: continua do mesmo ponto, com a mesma
              velocidade e o mesmo idioma — nada volta ao começo. */}
          {usandoNatural && leitura.erro ? (
            <span className="leitor__aviso-acoes">
              <button type="button" className="btn btn--sm" onClick={continuar}>
                Tentar de novo
              </button>
              <button type="button" className="btn btn--sm btn--accent" onClick={usarVozDoAparelho}>
                Usar a voz do aparelho daqui em diante
              </button>
              {ultimaFalha() ? (
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setVerDetalhe((v) => !v)}>
                  {verDetalhe ? 'Ocultar detalhes' : 'Ver detalhes'}
                </button>
              ) : null}
            </span>
          ) : null}

          {/* Falhou ao baixar: a escolha da voz continua onde estava. */}
          {falhaDaVoz && !leitura.erro ? (
            <span className="leitor__aviso-acoes">
              <button type="button" className="btn btn--sm" onClick={() => void baixarVoz()}>
                Tentar de novo
              </button>
              <button
                type="button"
                className="btn btn--sm btn--accent"
                onClick={() => {
                  setFalhaDaVoz(null)
                  usarVozDoAparelho()
                }}
              >
                Usar a voz do aparelho
              </button>
              {falhaDaVoz.detalhe ? (
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setVerDetalhe((v) => !v)}>
                  {verDetalhe ? 'Ocultar detalhes' : 'Ver detalhes'}
                </button>
              ) : null}
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setFalhaDaVoz(null)}>
                Fechar
              </button>
            </span>
          ) : null}

          {verDetalhe && (falhaDaVoz?.detalhe || ultimaFalha()) ? (
            <code className="leitor__detalhe">{falhaDaVoz?.detalhe || ultimaFalha()}</code>
          ) : null}
        </div>
      ) : null}

      <footer className="transporte">
        <div className="transporte__progresso">
          <div className="transporte__trilha" aria-hidden="true">
            <div className="transporte__preenchimento" style={{ width: `${andamento * 100}%` }} />
          </div>
          <span className="transporte__tempo mono">
            {ativo ? `faltam ≈ ${formatDuration(restante)}` : `${Math.round(andamento * 100)}%`}
          </span>
        </div>

        <div className="transporte__botoes">
          {/* O mesmo botão ouve, pausa e continua de onde parou. */}
          <button
            type="button"
            className="btn btn--primary transporte__principal"
            onClick={alternar}
            disabled={!TEM_VOZ || semTexto}
          >
            {tocando ? (
              <>
                {preparando ? <IconSpinner size={15} className="spin" /> : <IconPause size={15} />}
                {preparando ? 'Preparando…' : 'Pausar'}
              </>
            ) : (
              <>
                <IconPlay size={15} /> {estado === 'pausado' ? 'Continuar' : 'Ouvir'}
              </>
            )}
          </button>
          {/* Parar é o único que volta ao começo do texto. */}
          <button type="button" className="btn btn--danger" onClick={parar} disabled={!ativo}>
            <IconStop size={13} /> Parar
          </button>
        </div>
      </footer>
    </div>
  )
}

import {
  Fragment,
  useCallback,
  useEffect,
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
import { baixar, jaBaixadas, suportaVozNatural, vozNaturalDoIdioma } from './lib/vozNatural'
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
  const [baixando, setBaixando] = useState<number | null>(null)
  const [arquivo, setArquivo] = useState<string | null>(null)
  /** A tela acompanha a leitura? Uma rolagem manual desliga isto. */
  const [acompanhando, setAcompanhando] = useState(true)
  /** Tradução pronta do texto atual, quando existe. */
  const [traducao, setTraducao] = useState<{ de: string; para: string; texto: string } | null>(null)
  /** Qual das duas versões está sendo lida e mostrada. */
  const [versao, setVersao] = useState<'original' | 'traducao'>('original')
  const [destino, setDestino] = useState('en-US')
  /** Andamento de uma tarefa demorada (tradução ou reconhecimento). */
  const [tarefa, setTarefa] = useState<{ nome: string; etapa: string; fracao: number } | null>(null)
  /** Como cancelar a tarefa em andamento. */
  const cancelador = useRef<AbortController | null>(null)
  const [pedindoDrive, setPedindoDrive] = useState(false)
  const [abrindo, setAbrindo] = useState(false)
  const [arrastando, setArrastando] = useState(false)

  const areaRef = useRef<HTMLDivElement>(null)
  const campoRef = useRef<HTMLTextAreaElement>(null)
  const seletorRef = useRef<HTMLInputElement>(null)

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

  const palavras = useMemo(() => contarPalavras(texto), [texto])
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
    setBaixando(0)
    setRecado(null)
    try {
      await baixar(naturalDoIdioma.id, (fracao) => setBaixando(fracao))
      setBaixada(true)
      setFonte('natural')
    } catch {
      setRecado('Não foi possível baixar a voz natural. Confira a conexão e tente de novo.')
    } finally {
      setBaixando(null)
    }
  }, [naturalDoIdioma])

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

  useEffect(() => {
    const area = areaRef.current
    if (!area || !ativo || !acompanhando) return
    const alvo =
      area.querySelector<HTMLElement>('[data-ativa="1"]') ?? area.querySelector<HTMLElement>('.frase--ativa')
    if (!alvo) return

    // Só a área do texto rola; a conta é toda dentro dela.
    const caixa = alvo.getBoundingClientRect()
    const janela = area.getBoundingClientRect()
    if (caixa.top >= janela.top + FOLGA_ROLAGEM && caixa.bottom <= janela.bottom - FOLGA_ROLAGEM) return

    // Um pedido novo no meio da animação anterior a reinicia, e com palavras
    // em sequência a rolagem nunca sairia do lugar. Daí o intervalo mínimo.
    const agora = Date.now()
    if (agora - ultimaRolagem.current < ESPERA_ROLAGEM) return
    ultimaRolagem.current = agora

    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Deixa o trecho lido no meio da área visível.
    const deslocamento = caixa.top - janela.top - (janela.height - caixa.height) / 2
    area.scrollBy({ top: deslocamento, behavior: suave ? 'smooth' : 'auto' })
  }, [destaque, indice, ativo, acompanhando])

  /**
   * Rolar com o dedo ou com a roda do mouse solta a tela: a leitura segue,
   * mas a página fica onde a pessoa deixou até ela pedir para voltar.
   */
  useEffect(() => {
    const area = areaRef.current
    if (!area) return
    const soltar = () => setAcompanhando(false)
    area.addEventListener('wheel', soltar, { passive: true })
    area.addEventListener('touchmove', soltar, { passive: true })
    return () => {
      area.removeEventListener('wheel', soltar)
      area.removeEventListener('touchmove', soltar)
    }
  }, [editando])

  /** Leva a tela de volta ao trecho em leitura e volta a acompanhar. */
  const voltarAoTrecho = useCallback(() => {
    setAcompanhando(true)
    const area = areaRef.current
    const alvo =
      area?.querySelector<HTMLElement>('[data-ativa="1"]') ?? area?.querySelector<HTMLElement>('.frase--ativa')
    if (!area || !alvo) return
    const caixa = alvo.getBoundingClientRect()
    const janela = area.getBoundingClientRect()
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    area.scrollBy({
      top: caixa.top - janela.top - (janela.height - caixa.height) / 2,
      behavior: suave ? 'smooth' : 'auto',
    })
  }, [])

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
  }, [cancelarTarefa, parar])

  /**
   * Põe um texto novo em leitura. A tradução antiga não vale mais, e o idioma
   * é adivinhado — quem discordar corrige nos botões PT/EN/ES/DE.
   */
  const aplicarTexto = useCallback((novo: string, nomeDoArquivo: string | null) => {
    setTexto(novo)
    setTraducao(null)
    setVersao('original')
    setArquivo(nomeDoArquivo)
    setEditando(false)
    const descoberto = detectarIdioma(novo)
    if (descoberto) setIdioma(descoberto)
  }, [])

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
        setTraducao({ de: idioma, para, texto: traduzidos.join('\n') })
        setVersao('traducao')
        setDestino(para)
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
    (qual: 'original' | 'traducao') => {
      if (qual === versao) return
      parar()
      setVersao(qual)
      setAcompanhando(true)
    },
    [parar, versao],
  )

  // ── Google Drive ──────────────────────────────────────────────────────
  const abrirDoDrive = useCallback(async () => {
    const credenciais = drive.lerCredenciais()
    if (!credenciais) {
      setPedindoDrive(true)
      return
    }
    setRecado(null)
    setAbrindo(true)
    try {
      const escolhido = await drive.escolherArquivo(credenciais)
      if (!escolhido) return
      const baixado = await drive.baixarArquivo(escolhido, credenciais)
      setAbrindo(false)
      await abrirArquivo(baixado)
    } catch (erro) {
      setRecado(erro instanceof drive.ErroDoDrive ? erro.message : 'Não foi possível abrir o arquivo do Google Drive.')
    } finally {
      setAbrindo(false)
    }
  }, [abrirArquivo])

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
  }, [idiomaAtual, parar])

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
      : (leitura.erro ?? recado)

  return (
    <div className="leitor">
      <header className="leitor__topo">
        <div className="leitor__marca">
          <span className="leitor__mark">
            <IconSpeaker size={19} />
          </span>
          <span>
            <strong className="leitor__nome">Leitura em voz alta</strong>
            <span className="leitor__tag">Português · English · Español</span>
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
                disabled={abrindo}
                title="Abrir um arquivo do Google Drive"
              >
                <IconNuvem size={14} /> <span className="btn__texto">Drive</span>
              </button>
              <button
                type="button"
                className="btn btn--sm btn--accent"
                onClick={() => void traduzir(destino)}
                disabled={semTexto || tarefa !== null || mostrandoTraducao}
                title="Traduzir o texto"
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

          {traducao || tarefa ? (
            <div className="traducao-barra">
              {traducao ? (
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
              ) : (
                <label className="traducao-barra__novo">
                  <span className="field__label">Traduzir para</span>
                  <select
                    className="text-input select"
                    value={destino}
                    onChange={(evento) => {
                      setDestino(evento.target.value)
                      void traduzir(evento.target.value)
                    }}
                  >
                    {IDIOMAS.filter((item) => item.codigo !== idioma).map((item) => (
                      <option key={item.codigo} value={item.codigo}>
                        {item.nome}
                      </option>
                    ))}
                  </select>
                </label>
              )}
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
              value={texto}
              onChange={(evento) => {
                setTexto(evento.target.value)
                setArquivo(null)
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
                <div className="comparacao" aria-label={mostrandoTraducao ? 'Texto original' : 'Tradução'}>
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
                  onClick={() => setIdioma(item.codigo)}
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
                    ? `Baixando ${Math.round(baixando * 100)}%`
                    : baixada
                      ? 'Natural'
                      : `Natural · ${naturalDoIdioma?.tamanhoMB} MB`}
                </button>
              </div>
            ) : null}

            {baixando !== null ? (
              <div className="transporte__trilha" aria-hidden="true">
                <div className="transporte__preenchimento" style={{ width: `${baixando * 100}%` }} />
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

          <p className="ajuste__dica">
            Durante a leitura, clique em qualquer palavra do texto para continuar a partir dali — o trecho falado fica
            destacado. Você também pode arrastar um PDF, um Word (.docx) ou um .txt para cima do texto.
          </p>
        </aside>
      </main>

      {pedindoDrive ? (
        <div className="janela" role="dialog" aria-label="Configurar o Google Drive">
          <div className="janela__cartao">
            <h2 className="janela__titulo">Ligar o Google Drive</h2>
            <p className="janela__texto">
              O Drive precisa de dois códigos públicos da sua conta Google — eles ficam guardados só neste navegador,
              nunca no programa. O passo a passo está no arquivo <strong>LEIA-ME</strong> do projeto, em "Google Drive".
            </p>
            <form
              className="janela__form"
              onSubmit={(evento) => {
                evento.preventDefault()
                const dados = new FormData(evento.currentTarget)
                drive.guardarCredenciais(String(dados.get('cliente') ?? ''), String(dados.get('api') ?? ''))
                setPedindoDrive(false)
                void abrirDoDrive()
              }}
            >
              <label className="field__label" htmlFor="drive-cliente">
                ID do cliente OAuth
              </label>
              <input
                id="drive-cliente"
                name="cliente"
                className="text-input"
                placeholder="000000000000-xxxxxxxx.apps.googleusercontent.com"
                defaultValue={drive.lerCredenciais()?.cliente ?? ''}
                required
              />
              <label className="field__label" htmlFor="drive-api">
                Chave de API (navegador)
              </label>
              <input
                id="drive-api"
                name="api"
                className="text-input"
                placeholder="AIza…"
                defaultValue={drive.lerCredenciais()?.api ?? ''}
                required
              />
              <div className="janela__acoes">
                <button type="button" className="btn" onClick={() => setPedindoDrive(false)}>
                  Cancelar
                </button>
                <button type="submit" className="btn btn--primary">
                  Salvar e abrir
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {aviso ? (
        <div className="leitor__aviso" role="status">
          <IconAlert size={15} />
          <span>{aviso}</span>
          {usandoNatural && leitura.erro ? (
            <span className="leitor__aviso-acoes">
              <button type="button" className="btn btn--sm" onClick={continuar}>
                Tentar de novo
              </button>
              <button type="button" className="btn btn--sm btn--accent" onClick={usarVozDoAparelho}>
                Usar a voz do aparelho
              </button>
            </span>
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

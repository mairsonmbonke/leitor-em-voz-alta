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
import { ErroDeArquivo, TIPOS_ACEITOS, extrairTexto } from './lib/documento'
import { formatDuration } from './lib/format'
import {
  IconAlert,
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

/** Espera antes de aplicar um ajuste feito no meio da leitura. */
const ESPERA_AJUSTE = 260

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
  const [arquivo, setArquivo] = useState<string | null>(null)
  const [abrindo, setAbrindo] = useState(false)
  const [arrastando, setArrastando] = useState(false)

  const areaRef = useRef<HTMLDivElement>(null)
  const campoRef = useRef<HTMLTextAreaElement>(null)
  const seletorRef = useRef<HTMLInputElement>(null)

  const idiomaAtual = idiomaPorCodigo(idioma)
  const vozes = useVozes()
  const disponiveis = useMemo(() => vozesDoIdioma(vozes, idiomaAtual), [vozes, idiomaAtual])
  const voz = useMemo(() => escolherVoz(disponiveis, vozURI), [disponiveis, vozURI])

  const trechos = useMemo(() => segmentar(texto), [texto])
  const leitura = useLeitura(trechos, { idioma, voz, velocidade })
  const { estado, indice, destaque, posicao, iniciar, pausar, continuar, parar, reiniciar } = leitura

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
  useEffect(() => salvar(CHAVE_VELOCIDADE, String(velocidade)), [velocidade])
  useEffect(() => {
    if (voz) salvar(chaveVoz(idioma), voz.voiceURI)
  }, [voz, idioma])

  // Cada idioma lembra a própria voz.
  useEffect(() => setVozURI(ler(chaveVoz(idioma))), [idioma])

  // ── Ajustes no meio da leitura ────────────────────────────────────────
  const primeiro = useRef(true)
  useEffect(() => {
    if (primeiro.current) {
      primeiro.current = false
      return
    }
    // A espera evita recomeçar a fala a cada passo do controle de velocidade.
    const relogio = window.setTimeout(reiniciar, ESPERA_AJUSTE)
    return () => window.clearTimeout(relogio)
  }, [voz, velocidade, idioma, reiniciar])

  // ── Acompanhar a leitura na tela ──────────────────────────────────────
  useEffect(() => {
    const area = areaRef.current
    if (!area || !ativo) return
    const alvo =
      area.querySelector<HTMLElement>('[data-ativa="1"]') ?? area.querySelector<HTMLElement>('.frase--ativa')
    if (!alvo) return

    const caixa = alvo.getBoundingClientRect()
    const folgaTopo = 90
    const folgaBase = window.innerHeight - 180
    if (caixa.top >= folgaTopo && caixa.bottom <= folgaBase) return

    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    alvo.scrollIntoView({ block: 'center', behavior: suave ? 'smooth' : 'auto' })
  }, [destaque, indice, ativo])

  // ── Ações ─────────────────────────────────────────────────────────────
  const comecar = useCallback(() => {
    if (semTexto) return
    setEditando(false)
    setRecado(null)
    iniciar(trechos[0].inicio)
  }, [iniciar, semTexto, trechos])

  const alternar = useCallback(() => {
    if (estado === 'lendo') pausar()
    else if (estado === 'pausado') continuar()
    else comecar()
  }, [comecar, continuar, estado, pausar])

  const editar = useCallback(() => {
    parar()
    setEditando(true)
    window.setTimeout(() => campoRef.current?.focus(), 0)
  }, [parar])

  const limpar = useCallback(() => {
    parar()
    setTexto('')
    setArquivo(null)
    setEditando(true)
    setRecado(null)
  }, [parar])

  /** Abre um PDF, um .docx, um .odt ou um arquivo de texto. */
  const abrirArquivo = useCallback(
    async (escolhido: File) => {
      parar()
      setAbrindo(true)
      setRecado(null)
      try {
        const lido = await extrairTexto(escolhido)
        if (lido.texto.trim().length === 0) {
          throw new ErroDeArquivo('O arquivo foi aberto, mas não tem texto para ler.')
        }
        setTexto(lido.texto)
        setArquivo(lido.paginas ? `${lido.nome} · ${lido.paginas} ${lido.paginas === 1 ? 'página' : 'páginas'}` : lido.nome)
        setEditando(false)
      } catch (erro) {
        setRecado(erro instanceof ErroDeArquivo ? erro.message : 'Não foi possível abrir este arquivo.')
      } finally {
        setAbrindo(false)
      }
    },
    [parar],
  )

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
      setTexto(conteudo)
      setArquivo(null)
      setEditando(false)
      setRecado(null)
    } catch {
      setRecado('O navegador não liberou a área de transferência. Cole com Ctrl+V (ou ⌘+V) no campo de texto.')
    }
  }, [parar])

  /** Um clique numa palavra continua a leitura a partir dela. */
  const clicarNoTexto = useCallback(
    (evento: MouseEvent<HTMLDivElement>) => {
      const alvo = (evento.target as HTMLElement).closest('[data-pos]')
      if (!alvo) return
      const pos = Number(alvo.getAttribute('data-pos'))
      if (!Number.isFinite(pos)) return
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
              <button type="button" className="btn btn--sm btn--ghost" onClick={colar}>
                <IconClipboard size={14} /> Colar
              </button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={usarExemplo}>
                <IconWand size={14} /> Exemplo
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
            <div className="leitura" ref={areaRef} onClick={clicarNoTexto}>
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
          <div className="ajuste">
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

          <div className="ajuste">
            <label className="field__label" htmlFor="voz">
              Voz
            </label>
            <select
              id="voz"
              className="text-input select"
              value={voz?.voiceURI ?? ''}
              onChange={(evento) => setVozURI(evento.target.value)}
              disabled={disponiveis.length === 0}
            >
              {disponiveis.length === 0 ? (
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
              {disponiveis.length > 0
                ? `${disponiveis.length} ${disponiveis.length === 1 ? 'voz instalada' : 'vozes instaladas'} para ${idiomaAtual.nome}.`
                : 'As vozes vêm do sistema operacional.'}
            </p>
          </div>

          <div className="ajuste">
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

      {aviso ? (
        <div className="leitor__aviso" role="status">
          <IconAlert size={15} />
          <span>{aviso}</span>
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
          <button
            type="button"
            className="btn btn--primary transporte__principal"
            onClick={comecar}
            disabled={!TEM_VOZ || semTexto}
          >
            <IconPlay size={15} /> Iniciar
          </button>
          <button type="button" className="btn" onClick={pausar} disabled={!tocando}>
            <IconPause size={15} /> Pausar
          </button>
          <button type="button" className="btn" onClick={continuar} disabled={estado !== 'pausado'}>
            <IconPlay size={15} /> Continuar
          </button>
          <button type="button" className="btn btn--danger" onClick={parar} disabled={!ativo}>
            <IconStop size={13} /> Parar
          </button>
        </div>
      </footer>
    </div>
  )
}

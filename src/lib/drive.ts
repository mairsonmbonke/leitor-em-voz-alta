/**
 * Abrir um arquivo do Google Drive.
 *
 * Quem usa a página só toca em **Conectar ao Google Drive**, entra pela tela do
 * próprio Google, autoriza e escolhe o arquivo. Nada de códigos, chaves ou
 * configuração: isso é feito **uma única vez** por quem publica o site, no
 * arquivo `.env` (desenvolvimento) ou nas *variables* do repositório (GitHub
 * Actions). O passo a passo está no LEIA-ME, em "Google Drive".
 *
 * Sobre segredo: neste fluxo (OAuth para navegador, sem servidor) **não existe
 * senha nem chave secreta**. O que entra no build é o *ID do cliente*, que o
 * Google trata como público — ele aparece na barra de endereços em qualquer
 * login com Google e não dá acesso a nada sozinho. Quem protege a conta é a
 * lista de origens autorizadas no Google Cloud: um ID copiado só funciona no
 * endereço cadastrado. Mesmo assim ele não fica escrito no código-fonte: entra
 * no momento do build, a partir de uma variável.
 *
 * O acesso pedido é o mais estreito que o Google oferece:
 * - `drive.file` — apenas os arquivos que a pessoa escolher na janela do
 *   Google. O programa não enxerga o resto do Drive.
 * - `userinfo.email` — só para mostrar na tela qual conta está conectada.
 */

export class ErroDoDrive extends Error {}

/** Falta configuração do responsável pelo projeto, não da pessoa que usa. */
export class DriveNaoConfigurado extends ErroDoDrive {}

export interface ArquivoDoDrive {
  id: string
  nome: string
  tipo: string
}

/** Só os arquivos escolhidos pela pessoa, mais o e-mail de quem entrou. */
const ESCOPO = ['https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/userinfo.email'].join(' ')

/** Tipos que o seletor mostra. */
const TIPOS = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.google-apps.document',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
].join(',')

// ── Configuração feita uma vez por quem publica ───────────────────────

interface Ambiente {
  VITE_GOOGLE_CLIENT_ID?: string
  VITE_GOOGLE_API_KEY?: string
  VITE_GOOGLE_APP_ID?: string
}

function ambiente(): Ambiente {
  return ((import.meta.env ?? {}) as unknown as Ambiente) ?? {}
}

export function idDoCliente(): string {
  return (ambiente().VITE_GOOGLE_CLIENT_ID ?? '').trim()
}

function chaveDeApi(): string {
  return (ambiente().VITE_GOOGLE_API_KEY ?? '').trim()
}

function idDoProjeto(): string {
  return (ambiente().VITE_GOOGLE_APP_ID ?? '').trim()
}

/** O Drive está pronto para uso nesta publicação? */
export function configurado(): boolean {
  return idDoCliente().length > 0
}

function exigirConfiguracao(): string {
  const cliente = idDoCliente()
  if (!cliente) {
    throw new DriveNaoConfigurado(
      'O Google Drive ainda não foi ligado nesta publicação. Falta o responsável pelo projeto cadastrar o ' +
        'ID do cliente OAuth do Google (variável VITE_GOOGLE_CLIENT_ID) — o passo a passo está no LEIA-ME.',
    )
  }
  return cliente
}

// ── Sessão guardada ───────────────────────────────────────────────────

const CHAVE_SESSAO = 'leitor.drive.sessao'
/** Uma autorização perto de vencer não vale a pena reaproveitar. */
const FOLGA = 60_000

export interface SessaoDoDrive {
  token: string
  /** Instante (ms) em que a autorização deixa de valer. */
  vence: number
  conta: string | null
}

let sessao: SessaoDoDrive | null = null
/** Avisa a tela quando a conta conectada muda. */
const ouvintes = new Set<(s: SessaoDoDrive | null) => void>()

function anunciar(): void {
  for (const ouvinte of ouvintes) ouvinte(sessao)
}

export function aoMudarSessao(ouvinte: (s: SessaoDoDrive | null) => void): () => void {
  ouvintes.add(ouvinte)
  return () => {
    ouvintes.delete(ouvinte)
  }
}

function guardarSessao(nova: SessaoDoDrive | null): void {
  sessao = nova
  try {
    if (nova) localStorage.setItem(CHAVE_SESSAO, JSON.stringify(nova))
    else localStorage.removeItem(CHAVE_SESSAO)
  } catch {
    /* navegador com armazenamento bloqueado: vale só nesta aba */
  }
  anunciar()
}

/** A conta conectada, se houver uma autorização guardada. */
export function sessaoAtual(): SessaoDoDrive | null {
  if (sessao) return sessao
  try {
    const salvo = localStorage.getItem(CHAVE_SESSAO)
    if (!salvo) return null
    const lido = JSON.parse(salvo) as SessaoDoDrive
    if (!lido?.token) return null
    sessao = lido
    return lido
  } catch {
    return null
  }
}

function valida(): SessaoDoDrive | null {
  const atual = sessaoAtual()
  return atual && atual.vence - FOLGA > Date.now() ? atual : null
}

/** Está conectado (mesmo que a autorização precise ser renovada em silêncio)? */
export function conectado(): boolean {
  return sessaoAtual() !== null
}

// ── Carregamento dos scripts do Google ────────────────────────────────

const carregados = new Map<string, Promise<void>>()

function carregarScript(endereco: string): Promise<void> {
  const jaPedido = carregados.get(endereco)
  if (jaPedido) return jaPedido

  const promessa = new Promise<void>((pronto, falhou) => {
    const script = document.createElement('script')
    script.src = endereco
    script.async = true
    script.onload = () => pronto()
    script.onerror = () => {
      carregados.delete(endereco)
      falhou(
        new ErroDoDrive(
          'Não foi possível carregar o Google nesta página. Pode ser falta de internet ou um bloqueio da rede.',
        ),
      )
    }
    document.head.appendChild(script)
  })
  carregados.set(endereco, promessa)
  return promessa
}

interface ClienteDeToken {
  requestAccessToken: (opcoes?: { prompt?: string }) => void
}

interface Google {
  accounts: {
    oauth2: {
      initTokenClient: (opcoes: {
        client_id: string
        scope: string
        callback: (resposta: { access_token?: string; expires_in?: number; error?: string }) => void
        error_callback?: (erro: { type?: string; message?: string }) => void
      }) => ClienteDeToken
      revoke: (token: string, pronto?: () => void) => void
    }
  }
}

interface ApiGoogle {
  load: (nome: string, pronto: () => void) => void
}

function google(): Google {
  const g = (globalThis as { google?: Google }).google
  if (!g) throw new ErroDoDrive('O Google não terminou de carregar. Tente de novo.')
  return g
}

// ── Entrar, trocar de conta, sair ─────────────────────────────────────

/** Qual conta está do outro lado desta autorização? */
async function descobrirConta(token: string): Promise<string | null> {
  try {
    const resposta = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resposta.ok) return null
    const dados = (await resposta.json()) as { email?: string }
    return dados.email ?? null
  } catch {
    return null
  }
}

/**
 * Pede autorização ao Google.
 *
 * `modo`:
 * - `silencioso` — reaproveita a autorização válida; se venceu, renova sem
 *   perguntar nada (o Google só mostra tela se realmente precisar).
 * - `entrar` — a primeira conexão, com a tela de contas do Google.
 * - `trocar` — força a escolha de outra conta.
 */
async function autorizar(modo: 'silencioso' | 'entrar' | 'trocar' = 'silencioso'): Promise<SessaoDoDrive> {
  const cliente = exigirConfiguracao()

  const guardada = valida()
  if (guardada && modo === 'silencioso') return guardada

  await carregarScript('https://accounts.google.com/gsi/client')

  const recebido = await new Promise<{ token: string; segundos: number }>((pronto, falhou) => {
    const pedido = google().accounts.oauth2.initTokenClient({
      client_id: cliente,
      scope: ESCOPO,
      callback: (resposta) => {
        if (resposta.error || !resposta.access_token) {
          falhou(new ErroDoDrive('A autorização do Google não foi concluída.'))
          return
        }
        pronto({ token: resposta.access_token, segundos: Number(resposta.expires_in ?? 3600) })
      },
      error_callback: (erro) => {
        if (erro?.type === 'popup_closed') {
          falhou(new ErroDoDrive('A janela do Google foi fechada antes de terminar.'))
          return
        }
        if (erro?.type === 'popup_failed_to_open') {
          falhou(
            new ErroDoDrive(
              'O navegador bloqueou a janela do Google. Libere as janelas pop-up para este site e tente de novo. ' +
                'No iPhone: Ajustes → Safari → Bloquear janelas.',
            ),
          )
          return
        }
        falhou(new ErroDoDrive(erro?.message ?? 'A autorização do Google não foi concluída.'))
      },
    })
    pedido.requestAccessToken({ prompt: modo === 'trocar' ? 'select_account' : modo === 'entrar' ? 'consent' : '' })
  })

  const conta = await descobrirConta(recebido.token)
  const nova: SessaoDoDrive = { token: recebido.token, vence: Date.now() + recebido.segundos * 1000, conta }
  guardarSessao(nova)
  return nova
}

/** Conecta a conta do Google (é o botão "Conectar ao Google Drive"). */
export async function conectar(): Promise<SessaoDoDrive> {
  return autorizar(conectado() ? 'silencioso' : 'entrar')
}

/** Entra com outra conta. */
export async function trocarConta(): Promise<SessaoDoDrive> {
  return autorizar('trocar')
}

/** Desconecta: a autorização é cancelada no Google e some daqui. */
export async function desconectar(): Promise<void> {
  const atual = sessaoAtual()
  guardarSessao(null)
  if (!atual) return
  try {
    await carregarScript('https://accounts.google.com/gsi/client')
    await new Promise<void>((pronto) => {
      google().accounts.oauth2.revoke(atual.token, pronto)
      // O `revoke` nem sempre chama de volta; não vale travar a tela por isso.
      window.setTimeout(pronto, 1500)
    })
  } catch {
    /* já basta ter esquecido a autorização deste lado */
  }
}

// ── Seleção do arquivo ────────────────────────────────────────────────

interface Seletor {
  DocsView: new (tipo?: unknown) => {
    setIncludeFolders: (v: boolean) => unknown
    setMimeTypes: (t: string) => unknown
  }
  PickerBuilder: new () => {
    addView: (v: unknown) => unknown
    setOAuthToken: (t: string) => unknown
    setDeveloperKey: (k: string) => unknown
    setAppId: (id: string) => unknown
    setCallback: (f: (dados: { action: string; docs?: { id: string; name: string; mimeType: string }[] }) => void) => unknown
    setTitle: (t: string) => unknown
    build: () => { setVisible: (v: boolean) => void }
  }
  Action: { PICKED: string; CANCEL: string }
  ViewId: { DOCS: unknown }
}

/** Abre a janela do Google para a pessoa escolher um arquivo. */
export async function escolherArquivo(): Promise<ArquivoDoDrive | null> {
  const atual = await autorizar('silencioso')
  await carregarScript('https://apis.google.com/js/api.js')

  const api = (globalThis as { gapi?: ApiGoogle }).gapi
  if (!api) throw new ErroDoDrive('O seletor de arquivos do Google não carregou.')
  await new Promise<void>((pronto) => api.load('picker', pronto))

  // O construtor do seletor só existe depois do `load` acima.
  const picker = (google() as unknown as { picker: Seletor }).picker
  if (!picker?.PickerBuilder) throw new ErroDoDrive('O seletor de arquivos do Google não carregou.')

  return new Promise<ArquivoDoDrive | null>((pronto) => {
    const vista = new picker.DocsView(picker.ViewId.DOCS)
    vista.setIncludeFolders(true)
    vista.setMimeTypes(TIPOS)

    const seletor = new picker.PickerBuilder()
    seletor.addView(vista)
    seletor.setOAuthToken(atual.token)
    // A chave de API e o número do projeto são opcionais: sem eles o seletor
    // abre do mesmo jeito, e é isso que deixa a configuração curta.
    if (chaveDeApi()) seletor.setDeveloperKey(chaveDeApi())
    if (idDoProjeto()) seletor.setAppId(idDoProjeto())
    seletor.setTitle('Escolha o arquivo para ler')
    seletor.setCallback((dados) => {
      if (dados.action === picker.Action.PICKED && dados.docs?.[0]) {
        const doc = dados.docs[0]
        pronto({ id: doc.id, nome: doc.name, tipo: doc.mimeType })
      } else if (dados.action === picker.Action.CANCEL) {
        pronto(null)
      }
    })
    seletor.build().setVisible(true)
  })
}

// ── Download ──────────────────────────────────────────────────────────

/** Um documento do Google (Docs) precisa ser exportado, não baixado. */
function ehDocumentoDoGoogle(tipo: string): boolean {
  return tipo.startsWith('application/vnd.google-apps')
}

/** Traz o arquivo escolhido para dentro do navegador. */
export async function baixarArquivo(arquivo: ArquivoDoDrive): Promise<File> {
  const atual = await autorizar('silencioso')
  const cabecalho = { Authorization: `Bearer ${atual.token}` }

  if (arquivo.tipo === 'application/vnd.google-apps.document') {
    const resposta = await fetch(
      `https://www.googleapis.com/drive/v3/files/${arquivo.id}/export?mimeType=text%2Fplain`,
      { headers: cabecalho },
    )
    if (!resposta.ok) throw new ErroDoDrive('Não foi possível exportar este documento do Google.')
    const texto = await resposta.text()
    return new File([texto], `${arquivo.nome}.txt`, { type: 'text/plain' })
  }

  if (ehDocumentoDoGoogle(arquivo.tipo)) {
    throw new ErroDoDrive(
      'Este tipo de arquivo do Google (planilha ou apresentação) ainda não é lido aqui. ' +
        'Baixe como PDF e abra o PDF.',
    )
  }

  const resposta = await fetch(`https://www.googleapis.com/drive/v3/files/${arquivo.id}?alt=media`, {
    headers: cabecalho,
  })
  if (!resposta.ok) {
    if (resposta.status === 401 || resposta.status === 403) {
      guardarSessao(null)
      throw new ErroDoDrive('A autorização do Google venceu. Conecte-se de novo.')
    }
    throw new ErroDoDrive('Não foi possível baixar o arquivo do Google Drive.')
  }
  const dados = await resposta.blob()
  return new File([dados], arquivo.nome, { type: arquivo.tipo || dados.type })
}

/**
 * Abrir um arquivo do Google Drive.
 *
 * O acesso é o mais estreito que o Google oferece: o escopo `drive.file` dá
 * permissão **apenas aos arquivos que a própria pessoa escolher** na janela do
 * Google — o programa não enxerga o resto do Drive.
 *
 * Nada de segredo mora aqui. O identificador do aplicativo (`client_id`) e a
 * chave de navegador do seletor são valores públicos por natureza, e mesmo
 * assim ficam guardados no navegador de quem usa, não no código da página:
 * cada pessoa cadastra os seus em Ajustes → Google Drive. Assim ninguém herda
 * a conta de ninguém, e o repositório continua sem credenciais.
 */

export class ErroDoDrive extends Error {}

export interface ArquivoDoDrive {
  id: string
  nome: string
  tipo: string
}

const CHAVE_CLIENTE = 'leitor.drive.cliente'
const CHAVE_API = 'leitor.drive.api'

/** Só os arquivos escolhidos pela pessoa, nada além disso. */
const ESCOPO = 'https://www.googleapis.com/auth/drive.file'

/** Tipos que o seletor mostra. */
const TIPOS = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.google-apps.document',
  'text/plain',
  'text/markdown',
  'image/jpeg',
  'image/png',
  'image/heic',
].join(',')

export interface Credenciais {
  cliente: string
  api: string
}

export function lerCredenciais(): Credenciais | null {
  try {
    const cliente = localStorage.getItem(CHAVE_CLIENTE)?.trim()
    const api = localStorage.getItem(CHAVE_API)?.trim()
    return cliente && api ? { cliente, api } : null
  } catch {
    return null
  }
}

export function guardarCredenciais(cliente: string, api: string): void {
  try {
    localStorage.setItem(CHAVE_CLIENTE, cliente.trim())
    localStorage.setItem(CHAVE_API, api.trim())
  } catch {
    /* navegador com armazenamento bloqueado */
  }
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
    script.onerror = () => falhou(new ErroDoDrive('Não foi possível carregar o Google. Confira a conexão.'))
    document.head.appendChild(script)
  })
  carregados.set(endereco, promessa)
  return promessa
}

interface Google {
  accounts: {
    oauth2: {
      initTokenClient: (opcoes: {
        client_id: string
        scope: string
        callback: (resposta: { access_token?: string; error?: string }) => void
      }) => { requestAccessToken: (opcoes?: { prompt?: string }) => void }
    }
  }
  picker: Record<string, never>
}

interface ApiGoogle {
  load: (nome: string, pronto: () => void) => void
}

function google(): Google {
  const g = (globalThis as { google?: Google }).google
  if (!g) throw new ErroDoDrive('O Google não terminou de carregar. Tente de novo.')
  return g
}

// ── Entrada na conta ──────────────────────────────────────────────────

let token: string | null = null

/** Pede autorização à pessoa (ou reaproveita a que já foi dada). */
export async function entrar(credenciais: Credenciais, forcar = false): Promise<string> {
  if (token && !forcar) return token
  await carregarScript('https://accounts.google.com/gsi/client')

  return new Promise<string>((pronto, falhou) => {
    const cliente = google().accounts.oauth2.initTokenClient({
      client_id: credenciais.cliente,
      scope: ESCOPO,
      callback: (resposta) => {
        if (resposta.error || !resposta.access_token) {
          falhou(new ErroDoDrive('A autorização do Google não foi concluída.'))
          return
        }
        token = resposta.access_token
        pronto(token)
      },
    })
    cliente.requestAccessToken({ prompt: forcar ? 'consent' : '' })
  })
}

// ── Seleção do arquivo ────────────────────────────────────────────────

/** Abre a janela do Google para a pessoa escolher um arquivo. */
export async function escolherArquivo(credenciais: Credenciais): Promise<ArquivoDoDrive | null> {
  const acesso = await entrar(credenciais)
  await carregarScript('https://apis.google.com/js/api.js')

  const api = (globalThis as { gapi?: ApiGoogle }).gapi
  if (!api) throw new ErroDoDrive('O seletor do Google não carregou.')
  await new Promise<void>((pronto) => api.load('picker', pronto))

  // O construtor do seletor só existe depois do `load` acima.
  const picker = (google() as unknown as { picker: Record<string, new () => unknown> }).picker as unknown as {
    DocsView: new (tipo?: unknown) => { setIncludeFolders: (v: boolean) => unknown; setMimeTypes: (t: string) => unknown }
    PickerBuilder: new () => {
      addView: (v: unknown) => unknown
      setOAuthToken: (t: string) => unknown
      setDeveloperKey: (k: string) => unknown
      setCallback: (f: (dados: { action: string; docs?: { id: string; name: string; mimeType: string }[] }) => void) => unknown
      setTitle: (t: string) => unknown
      build: () => { setVisible: (v: boolean) => void }
    }
    Action: { PICKED: string; CANCEL: string }
    ViewId: { DOCS: unknown }
  }

  return new Promise<ArquivoDoDrive | null>((pronto) => {
    const vista = new picker.DocsView(picker.ViewId.DOCS)
    vista.setIncludeFolders(true)
    vista.setMimeTypes(TIPOS)

    const seletor = new picker.PickerBuilder()
    seletor.addView(vista)
    seletor.setOAuthToken(acesso)
    seletor.setDeveloperKey(credenciais.api)
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
export async function baixarArquivo(arquivo: ArquivoDoDrive, credenciais: Credenciais): Promise<File> {
  const acesso = await entrar(credenciais)

  if (arquivo.tipo === 'application/vnd.google-apps.document') {
    const resposta = await fetch(
      `https://www.googleapis.com/drive/v3/files/${arquivo.id}/export?mimeType=text%2Fplain`,
      { headers: { Authorization: `Bearer ${acesso}` } },
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
    headers: { Authorization: `Bearer ${acesso}` },
  })
  if (!resposta.ok) throw new ErroDoDrive('Não foi possível baixar o arquivo do Google Drive.')
  const dados = await resposta.blob()
  return new File([dados], arquivo.nome, { type: arquivo.tipo || dados.type })
}

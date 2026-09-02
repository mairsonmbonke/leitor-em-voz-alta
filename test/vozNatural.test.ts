/**
 * Testes do download da voz natural.
 *
 * O que se quer garantir aqui é justamente o que faltava antes: quando alguma
 * coisa dá errado ao buscar o modelo, a mensagem tem de dizer **o que** deu
 * errado — não "confira a conexão". E nada quebrado pode ficar guardado.
 *
 * O navegador é imitado no que a função usa: `fetch`, o armazenamento privado
 * (OPFS) e a estimativa de espaço.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

// ── Um navegador de mentira ───────────────────────────────────────────

interface ArquivoFalso {
  dados: Uint8Array
}

const guardados = new Map<string, ArquivoFalso>()

function pastaFalsa() {
  return {
    async getFileHandle(nome: string, opcoes?: { create?: boolean }) {
      if (!guardados.has(nome)) {
        if (!opcoes?.create) throw new Error('NotFoundError')
        guardados.set(nome, { dados: new Uint8Array(0) })
      }
      return {
        async getFile() {
          return { size: guardados.get(nome)!.dados.byteLength }
        },
        async createWritable() {
          return {
            async write(dados: ArrayBuffer) {
              guardados.set(nome, { dados: new Uint8Array(dados) })
            },
            async close() {},
          }
        },
      }
    },
    async removeEntry(nome: string) {
      if (!guardados.delete(nome)) throw new Error('NotFoundError')
    },
  }
}

const navegadorFalso = {
  onLine: true,
  storage: {
    async getDirectory() {
      return { async getDirectoryHandle() { return pastaFalsa() } }
    },
    async estimate() {
      return { quota: 500 * 1024 * 1024, usage: 0 }
    },
  },
}

Object.defineProperty(globalThis, 'window', { value: globalThis, writable: true, configurable: true })
Object.defineProperty(globalThis, 'navigator', { value: navegadorFalso, writable: true, configurable: true })
Object.defineProperty(globalThis, 'location', {
  value: { href: 'https://exemplo.test/leitor/' },
  writable: true,
  configurable: true,
})

/** Uma resposta de `fetch` pronta, com o corpo em pedaços. */
function resposta(dados: Uint8Array, { ok = true, status = 200, tipo = 'application/octet-stream' } = {}) {
  let entregue = false
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Erro',
    headers: { get: (nome: string) => (nome === 'Content-Length' ? String(dados.byteLength) : tipo) },
    body: {
      getReader: () => ({
        async read() {
          if (entregue) return { done: true, value: undefined }
          entregue = true
          return { done: false, value: dados }
        },
      }),
    },
    async arrayBuffer() {
      return dados.buffer
    },
  }
}

const CONFIGURACAO = new TextEncoder().encode(
  JSON.stringify({ audio: { sample_rate: 22050 }, espeak: { voice: 'pt-br' } }),
)
const MODELO = new Uint8Array(6 * 1024 * 1024).fill(8)
const PAGINA_DE_ERRO = new TextEncoder().encode('<!DOCTYPE html><html><body>Not found</body></html>')

/** Troca o `fetch` por uma função que responde conforme o endereço pedido. */
function comFetch(responder: (endereco: string) => unknown) {
  ;(globalThis as { fetch?: unknown }).fetch = async (endereco: string) => {
    const resultado = responder(endereco)
    if (resultado instanceof Error) throw resultado
    return resultado
  }
}

const voz = await import('../src/lib/vozNatural.ts')

function limpar() {
  guardados.clear()
}

// ── Os testes ─────────────────────────────────────────────────────────

test('o download bem-sucedido guarda o modelo e os ajustes', async () => {
  limpar()
  comFetch((endereco) => resposta(endereco.endsWith('.json') ? CONFIGURACAO : MODELO))

  const passos: string[] = []
  await voz.baixar('pt_BR-faber-medium', (andamento) => passos.push(andamento.etapa))

  assert.ok(passos.includes('modelo'), 'não avisou o andamento do modelo')
  assert.ok(passos.includes('guardando'), 'não avisou a gravação')
  assert.deepEqual(await voz.jaBaixadas(), ['pt_BR-faber-medium'])
})

test('o andamento vem em bytes de verdade, com o total do servidor', async () => {
  limpar()
  comFetch((endereco) => resposta(endereco.endsWith('.json') ? CONFIGURACAO : MODELO))

  let ultimo = { baixados: 0, total: 0 }
  await voz.baixar('en_US-hfc_female-medium', (andamento) => {
    if (andamento.etapa === 'modelo') ultimo = andamento
  })
  assert.equal(ultimo.total, MODELO.byteLength)
  assert.equal(ultimo.baixados, MODELO.byteLength)
})

test('um 404 diz que é um 404, com o servidor, e não culpa a internet', async () => {
  limpar()
  comFetch(() => resposta(PAGINA_DE_ERRO, { ok: false, status: 404 }))

  const erro = await voz.baixar('pt_BR-faber-medium').then(
    () => null,
    (e) => e as InstanceType<typeof voz.ErroDeVoz>,
  )
  assert.ok(erro, 'devia ter falhado')
  assert.match(erro.message, /404/)
  assert.match(erro.message, /huggingface\.co/)
  assert.doesNotMatch(erro.message, /Confira a conexão/)
  assert.match(erro.detalhe, /HTTP 404/)
  assert.deepEqual(await voz.jaBaixadas(), [], 'ficou lixo guardado depois da falha')
})

test('uma página de erro no lugar do modelo é reconhecida como tal', async () => {
  limpar()
  comFetch((endereco) => resposta(endereco.endsWith('.json') ? CONFIGURACAO : PAGINA_DE_ERRO))

  const erro = await voz.baixar('pt_BR-faber-medium').then(
    () => null,
    (e) => e as InstanceType<typeof voz.ErroDeVoz>,
  )
  assert.ok(erro)
  assert.match(erro.message, /página de erro/)
  assert.deepEqual(await voz.jaBaixadas(), [])
})

test('um bloqueio de rede ou CORS aparece como bloqueio, não como falta de internet', async () => {
  limpar()
  comFetch(() => new TypeError('Failed to fetch'))

  const erro = await voz.baixar('pt_BR-faber-medium').then(
    () => null,
    (e) => e as InstanceType<typeof voz.ErroDeVoz>,
  )
  assert.ok(erro)
  assert.match(erro.message, /bloqueado|bloqueio/)
  assert.match(erro.detalhe, /huggingface\.co/)
})

test('quando o primeiro endereço falha, o segundo é tentado', async () => {
  limpar()
  const pedidos: string[] = []
  comFetch((endereco) => {
    pedidos.push(endereco)
    if (endereco.includes('rhasspy')) return resposta(PAGINA_DE_ERRO, { ok: false, status: 404 })
    return resposta(endereco.endsWith('.json') ? CONFIGURACAO : MODELO)
  })

  await voz.baixar('es_ES-davefx-medium')
  assert.ok(pedidos.some((p) => p.includes('rhasspy')))
  assert.ok(pedidos.some((p) => p.includes('diffusionstudio')))
  assert.deepEqual(await voz.jaBaixadas(), ['es_ES-davefx-medium'])
})

test('sem espaço no navegador, a mensagem diz isso — e nem tenta baixar', async () => {
  limpar()
  let pediu = false
  comFetch(() => {
    pediu = true
    return resposta(MODELO)
  })
  navegadorFalso.storage.estimate = async () => ({ quota: 100 * 1024 * 1024, usage: 95 * 1024 * 1024 })

  const erro = await voz.baixar('pt_BR-faber-medium').then(
    () => null,
    (e) => e as InstanceType<typeof voz.ErroDeVoz>,
  )
  navegadorFalso.storage.estimate = async () => ({ quota: 500 * 1024 * 1024, usage: 0 })

  assert.ok(erro)
  assert.match(erro.message, /espaço/)
  assert.equal(pediu, false, 'baixou 60 MB sabendo que não caberia')
})

test('um modelo quebrado que sobrou de antes é descartado, não reaproveitado', async () => {
  limpar()
  // O que a versão anterior do programa chegava a guardar: uma página de erro
  // com nome de modelo.
  guardados.set('pt_BR-faber-medium.onnx', { dados: PAGINA_DE_ERRO })
  guardados.set('pt_BR-faber-medium.onnx.json', { dados: CONFIGURACAO })

  assert.deepEqual(await voz.jaBaixadas(), [], 'aceitou um modelo quebrado como bom')
  assert.equal(guardados.size, 0, 'o lixo continuou ocupando espaço')
})

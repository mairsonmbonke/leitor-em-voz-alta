import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectarIdioma, dividirParaTraduzir, emParagrafos, traduzirParagrafos } from '../src/lib/traducao.ts'

test('descobre o idioma dos quatro oferecidos', () => {
  assert.equal(
    detectarIdioma('Este é um texto em português que fala sobre uma coisa muito comum quando se lê em voz alta.'),
    'pt-BR',
  )
  assert.equal(
    detectarIdioma('This is a text in English that talks about the things which people have when they read aloud.'),
    'en-US',
  )
  assert.equal(
    detectarIdioma('Este es un texto en español que habla sobre los libros, pero con una voz muy clara cuando se lee.'),
    'es-ES',
  )
  assert.equal(
    detectarIdioma('Das ist ein Text auf Deutsch, der nicht sehr lang ist und mit einer Stimme für alle Leser ist.'),
    'de-DE',
  )
})

test('não arrisca um palpite com texto curto demais', () => {
  assert.equal(detectarIdioma('Olá'), null)
  assert.equal(detectarIdioma(''), null)
  assert.equal(detectarIdioma('123 456 789'), null)
})

test('separa os parágrafos e descarta as linhas vazias', () => {
  assert.deepEqual(emParagrafos('Um\n\n  Dois  \n\n\nTrês\n'), ['Um', 'Dois', 'Três'])
  assert.deepEqual(emParagrafos('   \n  '), [])
})

test('divide o parágrafo em pedaços que cabem no pedido', () => {
  const frase = 'Esta é uma frase de tamanho conhecido para o teste. '
  const paragrafo = frase.repeat(12).trim()
  const pedacos = dividirParaTraduzir(paragrafo, 200)

  assert.ok(pedacos.length > 1)
  for (const pedaco of pedacos) assert.ok(pedaco.length <= 200, `pedaço com ${pedaco.length} caracteres`)
  // Nada se perde no caminho.
  assert.equal(pedacos.join(' ').replace(/\s+/g, ' '), paragrafo.replace(/\s+/g, ' '))
})

test('parágrafo curto não é dividido', () => {
  assert.deepEqual(dividirParaTraduzir('Uma frase só.', 200), ['Uma frase só.'])
})

test('frase gigante sem pontuação também é cortada', () => {
  const gigante = 'palavra '.repeat(80).trim()
  const pedacos = dividirParaTraduzir(gigante, 100)
  for (const pedaco of pedacos) assert.ok(pedaco.length <= 100)
  assert.equal(pedacos.join(' '), gigante)
})

// ── MyMemory: insistir quando o serviço pede para esperar ─────────────
// Sem `Translator` no ambiente (é o caso do Node, como no Safari), a tradução
// cai no MyMemory. Aqui o `fetch` é substituído para exercitar as recusas.

function respostaDoMyMemory(texto: string) {
  return {
    ok: true,
    status: 200,
    async json() {
      return { responseData: { translatedText: texto }, responseStatus: 200 }
    },
  }
}

function recusa(status: number) {
  return { ok: false, status, async json() { return {} } }
}

function comFetch(respostas: unknown[]) {
  const pedidos: string[] = []
  ;(globalThis as { fetch?: unknown }).fetch = async (endereco: string) => {
    pedidos.push(endereco)
    const proxima = respostas.shift()
    if (proxima instanceof Error) throw proxima
    return proxima
  }
  return pedidos
}

test('um 429 do MyMemory não derruba a tradução: ele insiste', async () => {
  const pedidos = comFetch([recusa(429), respostaDoMyMemory('translated')])
  const saida = await traduzirParagrafos(['Um parágrafo qualquer.'], 'pt-BR', 'en-US')

  assert.deepEqual(saida, ['translated'])
  assert.equal(pedidos.length, 2, 'não tentou de novo depois do 429')
})

test('uma queda de conexão também ganha segunda chance', async () => {
  const pedidos = comFetch([new TypeError('Failed to fetch'), respostaDoMyMemory('ok')])
  assert.deepEqual(await traduzirParagrafos(['Texto.'], 'pt-BR', 'en-US'), ['ok'])
  assert.equal(pedidos.length, 2)
})

test('quando o 429 insiste, a explicação diz que é limite de ritmo', async () => {
  comFetch([recusa(429), recusa(429), recusa(429)])
  const erro = await traduzirParagrafos(['Texto.'], 'pt-BR', 'en-US').then(
    () => null,
    (e: Error) => e,
  )
  assert.ok(erro)
  assert.match(erro.message, /esperar|muitos pedidos/i)
})

test('um erro que não melhora com insistência falha na hora', async () => {
  const pedidos = comFetch([recusa(400)])
  await traduzirParagrafos(['Texto.'], 'pt-BR', 'en-US').then(
    () => assert.fail('devia ter falhado'),
    () => undefined,
  )
  assert.equal(pedidos.length, 1, 'insistiu num erro que não ia melhorar')
})

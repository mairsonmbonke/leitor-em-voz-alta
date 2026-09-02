/**
 * Teste do cancelamento do reconhecimento de texto.
 *
 * Encerrar o trabalhador do Tesseract mata o Web Worker por baixo, e o pedido
 * que estava a caminho pode nunca responder. Sem cuidado, cancelar deixaria uma
 * promessa pendurada para sempre — a tela até se recupera, mas o trabalho fica
 * preso na memória. Aqui o trabalhador de mentira nunca responde, de propósito.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ErroDeOcr, reconhecerImagem } from '../src/lib/ocr.ts'

interface MotorFalso {
  createWorker: () => Promise<{
    recognize: () => Promise<{ data: { text: string } }>
    terminate: () => Promise<unknown>
  }>
}

/** Um Tesseract que nunca devolve resposta, como o que foi encerrado. */
function motorMudo(aoEncerrar: () => void): MotorFalso {
  return {
    async createWorker() {
      return {
        recognize: () => new Promise<{ data: { text: string } }>(() => {}),
        terminate: async () => aoEncerrar(),
      }
    },
  }
}

test('cancelar o reconhecimento devolve o erro em vez de ficar pendurado', async () => {
  let encerrado = false
  ;(globalThis as { __motorDeOcrDeTeste?: MotorFalso }).__motorDeOcrDeTeste = motorMudo(() => {
    encerrado = true
  })

  const controle = new AbortController()
  const promessa = reconhecerImagem(new Blob(['x']), 'pt-BR', undefined, controle.signal)
  setTimeout(() => controle.abort(), 20)

  const erro = await Promise.race([
    promessa.then(
      () => new Error('não devia ter dado certo'),
      (e: unknown) => e,
    ),
    new Promise((pronto) => setTimeout(() => pronto('pendurada'), 2000)),
  ])

  assert.ok(erro instanceof ErroDeOcr, `o cancelamento devolveu: ${String(erro)}`)
  assert.match((erro as ErroDeOcr).message, /cancelad/i)
  assert.equal(encerrado, true, 'o trabalhador não foi encerrado')
})

test('cancelar antes de começar nem chega a abrir o trabalhador', async () => {
  let abriu = false
  ;(globalThis as { __motorDeOcrDeTeste?: MotorFalso }).__motorDeOcrDeTeste = {
    async createWorker() {
      abriu = true
      return { recognize: async () => ({ data: { text: '' } }), terminate: async () => undefined }
    },
  }

  const controle = new AbortController()
  controle.abort()
  await reconhecerImagem(new Blob(['x']), 'pt-BR', undefined, controle.signal).then(
    () => assert.fail('devia ter recusado'),
    (erro: unknown) => assert.ok(erro instanceof ErroDeOcr),
  )
  assert.equal(abriu, false)
})

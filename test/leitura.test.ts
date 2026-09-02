import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  contarPalavras,
  dividirEmPalavras,
  limitarVelocidade,
  progresso,
  segmentar,
  trechoNaPosicao,
} from '../src/lib/leitura.ts'

test('quebra o texto em frases e mantém as posições originais', () => {
  const texto = 'Primeira frase. Segunda frase! Terceira?'
  const trechos = segmentar(texto)

  assert.deepEqual(
    trechos.map((t) => t.texto),
    ['Primeira frase.', 'Segunda frase!', 'Terceira?'],
  )
  for (const trecho of trechos) {
    assert.equal(texto.slice(trecho.inicio, trecho.fim), trecho.texto)
  }
})

test('cada linha vira um parágrafo', () => {
  const trechos = segmentar('Um. Dois.\n\nTrês.')
  assert.deepEqual(
    trechos.map((t) => t.paragrafo),
    [0, 0, 1],
  )
})

test('não quebra a frase em abreviações nem em iniciais', () => {
  const trechos = segmentar('O Dr. Silva chegou. J. R. Tolkien escreveu.')
  assert.deepEqual(
    trechos.map((t) => t.texto),
    ['O Dr. Silva chegou.', 'J. R. Tolkien escreveu.'],
  )
})

test('não quebra números com ponto decimal', () => {
  const trechos = segmentar('O valor é 3.14 no total. Fim.')
  assert.deepEqual(
    trechos.map((t) => t.texto),
    ['O valor é 3.14 no total.', 'Fim.'],
  )
})

test('mantém as reticências e as aspas com a frase', () => {
  const trechos = segmentar('Ele disse "vamos lá." E foi. Depois... nada.')
  assert.deepEqual(
    trechos.map((t) => t.texto),
    ['Ele disse "vamos lá."', 'E foi.', 'Depois... nada.'],
  )
})

test('quebra frases longas demais sem perder nenhum caractere', () => {
  const texto = `${'palavra '.repeat(60).trim()}, e continua sem ponto final`
  const trechos = segmentar(texto)

  assert.ok(trechos.length > 1, 'a frase longa deveria ter sido dividida')
  for (const trecho of trechos) {
    assert.ok(trecho.texto.length <= 200, `trecho com ${trecho.texto.length} caracteres`)
    assert.equal(texto.slice(trecho.inicio, trecho.fim), trecho.texto)
  }
  const juntos = trechos.map((t) => t.texto).join(' ')
  assert.equal(juntos.replace(/\s+/g, ' '), texto.replace(/\s+/g, ' '))
})

test('ignora linhas em branco e espaços nas pontas', () => {
  const trechos = segmentar('\n\n   Só isto.   \n \n')
  assert.equal(trechos.length, 1)
  assert.equal(trechos[0].texto, 'Só isto.')
})

test('as palavras apontam para a posição certa do texto', () => {
  const texto = 'Bom dia, mundo.'
  const [trecho] = segmentar(texto)
  const palavras = dividirEmPalavras(trecho)

  assert.deepEqual(
    palavras.map((p) => p.texto),
    ['Bom', 'dia,', 'mundo.'],
  )
  for (const palavra of palavras) {
    assert.equal(texto.slice(palavra.inicio, palavra.fim), palavra.texto)
  }
})

test('encontra o trecho que continua a leitura a partir de uma posição', () => {
  const trechos = segmentar('Uma. Duas. Três.')

  assert.equal(trechoNaPosicao(trechos, 0), 0)
  assert.equal(trechoNaPosicao(trechos, 2), 0)
  // O espaço entre duas frases leva à frase seguinte.
  assert.equal(trechoNaPosicao(trechos, 4), 1)
  assert.equal(trechoNaPosicao(trechos, 11), 2)
  assert.equal(trechoNaPosicao(trechos, 99), -1)
})

test('o progresso vai de 0 a 1 ao longo do texto', () => {
  const trechos = segmentar('Uma. Duas. Três.')
  assert.equal(progresso(trechos, 0), 0)
  assert.equal(progresso(trechos, 16), 1)
  assert.ok(progresso(trechos, 8) > 0 && progresso(trechos, 8) < 1)
  assert.equal(progresso([], 5), 0)
})

test('conta palavras ignorando espaços repetidos', () => {
  assert.equal(contarPalavras('  três   palavras aqui '), 3)
  assert.equal(contarPalavras('   '), 0)
})

test('a velocidade fica dentro dos limites', () => {
  assert.equal(limitarVelocidade(0.1), 0.5)
  assert.equal(limitarVelocidade(9), 2)
  assert.equal(limitarVelocidade(Number.NaN), 1)
  assert.equal(limitarVelocidade(1.23), 1.25)
})

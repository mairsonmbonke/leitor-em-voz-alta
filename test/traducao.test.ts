import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectarIdioma, dividirParaTraduzir, emParagrafos } from '../src/lib/traducao.ts'

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

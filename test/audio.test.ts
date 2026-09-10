import test from 'node:test'
import assert from 'node:assert/strict'
import { ehAudio } from '../src/lib/audio.ts'
import { emParagrafosDeFala } from '../src/lib/transcricao.ts'

test('reconhece os áudios que o WhatsApp entrega', () => {
  // Android e WhatsApp Web: Opus dentro de um Ogg.
  assert.equal(ehAudio('PTT-20260901-WA0007.opus', ''), true)
  assert.equal(ehAudio('audio.ogg', 'audio/ogg; codecs=opus'), true)
  // iPhone, ao compartilhar: costuma sair como m4a ou mp4.
  assert.equal(ehAudio('AUD-20260901-WA0003.m4a', ''), true)
  assert.equal(ehAudio('gravacao', 'audio/mp4'), true)
  // Gravador do celular e do computador.
  assert.equal(ehAudio('memo.wav', ''), true)
  assert.equal(ehAudio('entrevista.mp3', 'audio/mpeg'), true)
})

test('um vídeo entra pelo som, não pela imagem', () => {
  assert.equal(ehAudio('reuniao.mp4', 'video/mp4'), true)
  assert.equal(ehAudio('clipe.mov', ''), true)
})

test('documentos e fotos não são confundidos com áudio', () => {
  assert.equal(ehAudio('contrato.pdf', 'application/pdf'), false)
  assert.equal(ehAudio('foto.jpg', 'image/jpeg'), false)
  assert.equal(ehAudio('anotacoes.txt', 'text/plain'), false)
  assert.equal(ehAudio('planilha.csv', 'text/csv'), false)
})

test('a transcrição vira parágrafos de tamanho humano', () => {
  const corrido =
    'Oi tudo bem. Estou te mandando esse áudio para combinar o horário. ' +
    'Pode ser amanhã de manhã? Se não der, me avisa. Eu fico o dia todo em casa. ' +
    'Depois a gente conversa melhor.'
  const saida = emParagrafosDeFala(corrido)
  const paragrafos = saida.split('\n')

  assert.ok(paragrafos.length >= 2, `ficou tudo num parágrafo só: ${saida}`)
  // Nenhuma palavra pode se perder no caminho.
  assert.equal(saida.replace(/\s+/g, ' ').trim(), corrido.replace(/\s+/g, ' ').trim())
})

test('um áudio de uma frase só continua sendo um parágrafo', () => {
  assert.equal(emParagrafosDeFala('  Cheguei.  '), 'Cheguei.')
})

test('texto vazio não vira parágrafo nenhum', () => {
  assert.equal(emParagrafosDeFala('   '), '')
})

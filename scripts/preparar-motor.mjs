/**
 * Copia para `public/motor/` os arquivos binários de que a voz natural precisa.
 *
 * Por que não deixar que a biblioteca os busque sozinha: ela pede tudo a CDNs
 * externos, com versões fixas no código que não batem com as instaladas aqui —
 * e o navegador falha ao carregar o modelo, com a mensagem enganosa de que a
 * culpa seria da conexão.
 *
 * Servindo os arquivos da própria página, some a diferença de versão, some o
 * CORS, some o CDN bloqueado por firewall — e o que roda em desenvolvimento é
 * exatamente o que vai publicado.
 */
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..')
const destino = join(raiz, 'public', 'motor')

// O motor de inferência (`onnxruntime-web`) não entra aqui: o próprio build
// empacota o WebAssembly dele e resolve o endereço sozinho. O que falta é o
// conversor de letras em sons (fonemas) e os dados de idioma do espeak-ng.
const ARQUIVOS = [
  'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm',
  'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data',
]

/**
 * A transcrição tem o mesmo problema, e é o próprio `@huggingface/transformers`
 * que o cria: ele pede o `onnxruntime-web` a um CDN, no endereço da versão que
 * fixou no código — uma versão de **desenvolvimento**, cujo otimizador de grafo
 * recusava os pesos comprimidos do Whisper ("Missing required scale"). O
 * `overrides` do package.json prende o projeto inteiro a uma versão estável, e
 * é dela que estes arquivos saem.
 */
const DA_TRANSCRICAO = [
  'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.wasm',
  'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs',
]

async function copiar(lista, pasta, etiqueta) {
  await mkdir(pasta, { recursive: true })
  for (const caminho of lista) {
    const origem = join(raiz, caminho)
    const nome = caminho.split('/').at(-1)
    try {
      await stat(origem)
    } catch {
      console.error(`\n[${etiqueta}] Arquivo não encontrado: ${caminho}\nRode "npm install" antes do build.\n`)
      process.exit(1)
    }
    await copyFile(origem, join(pasta, nome))
    const { size } = await stat(join(pasta, nome))
    console.log(`[${etiqueta}] ${nome} — ${(size / 1024 / 1024).toFixed(1)} MB`)
  }
}

await copiar(ARQUIVOS, destino, 'voz natural')
await copiar(DA_TRANSCRICAO, join(destino, 'transcricao'), 'transcrição')

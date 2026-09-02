import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * O GitHub Pages publica projetos em `/<nome-do-repositório>/`, então o build
 * precisa desse prefixo nos caminhos dos arquivos. Em desenvolvimento a
 * aplicação continua na raiz. Se o repositório for renomeado, ajuste aqui.
 */
const BASE_PAGES = '/leitor-em-voz-alta/'

export default defineConfig(({ command, isPreview }) => ({
  // O `preview` serve o build, então precisa do mesmo prefixo dele.
  base: command === 'build' || isPreview ? BASE_PAGES : '/',
  plugins: [react()],
  server: { port: 5173, host: true },
}))

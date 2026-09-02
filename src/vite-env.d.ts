/// <reference types="vite/client" />

// O pdf.js roda num Web Worker; o sufixo `?worker` é o jeito do Vite de
// empacotar esse arquivo separado.
declare module 'pdfjs-dist/build/pdf.worker.min.mjs?worker' {
  const construtorDoWorker: new () => Worker
  export default construtorDoWorker
}

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Leitor } from './Leitor'
import './styles/global.css'
import './styles/leitor.css'

const container = document.getElementById('root')
if (!container) throw new Error('Elemento #root não encontrado.')

createRoot(container).render(
  <StrictMode>
    <Leitor />
  </StrictMode>,
)

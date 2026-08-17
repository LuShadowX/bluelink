import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { registerServiceWorker } from './lib/registerServiceWorker'
import './styles/base.css'
import './styles/layout.css'
import './styles/cards.css'
import './styles/overlays.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
)

registerServiceWorker()

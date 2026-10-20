import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { WidgetApp } from './WidgetApp'
import './widget.css'

document.documentElement.dataset.platform = window.lifeUnlockedWidget.platform

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <WidgetApp />
  </StrictMode>
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { NotificationApp } from './NotificationApp'
import './notification.css'

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <NotificationApp />
  </StrictMode>
)

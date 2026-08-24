import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ShelfApp } from './shelf/ShelfApp'
import { installSystemTheme } from './shelf/system-theme'

installSystemTheme()
const root = document.getElementById('root')
if (!root) throw new Error('Missing Amove shelf root')
createRoot(root).render(<StrictMode><ShelfApp /></StrictMode>)

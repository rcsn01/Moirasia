import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { MainApp } from './main/MainApp'

const root = document.getElementById('root')
if (!root) throw new Error('Missing Amove main root')
createRoot(root).render(<StrictMode><MainApp /></StrictMode>)

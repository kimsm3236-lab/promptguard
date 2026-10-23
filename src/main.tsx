import React from 'react'
import {createRoot} from 'react-dom/client'
import Home from './routes/index'
import {TooltipProvider} from './components/ui/tooltip'
import {Toaster} from './components/ui/sonner'
import './styles.css'
createRoot(document.getElementById('root')!).render(<React.StrictMode><TooltipProvider><Home/><Toaster/></TooltipProvider></React.StrictMode>)

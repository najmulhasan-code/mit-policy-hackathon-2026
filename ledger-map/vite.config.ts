import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// base './' so the built page works from any folder or static host
export default defineConfig({ base: './', plugins: [react()] })

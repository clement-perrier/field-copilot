import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Autorise l'accès via un host public (tunnel Cloudflare/ngrok pour tests
    // à distance) : Vite 8 rejette par défaut tout header Host non reconnu
    // (protection anti DNS-rebinding). Prototype de démo temporaire, pas de
    // production exposée en continu — ce réglage n'a de sens que dans ce cadre.
    allowedHosts: true,
    // En dev, le frontend (port 5173) et le backend FastAPI (port 8000) tournent
    // sur des ports séparés. Ce proxy évite de gérer CORS pour le développement
    // local : le navigateur ne voit qu'une seule origine (5173), Vite relaie les
    // requêtes /api/* vers le backend en coulisses.
    //
    // La cible est surchargeable par variable d'env, même schéma que
    // DATABASE_URL côté backend (voir docker-compose.yml) : en local hors
    // Docker, le backend tourne aussi sur localhost, donc la valeur par défaut
    // convient. Dans le conteneur frontend, "localhost" désigne le conteneur
    // lui-même, pas le conteneur backend — docker-compose.yml fixe donc
    // VITE_BACKEND_URL=http://backend:8000 (le nom du service Docker) pour ce cas.
    proxy: {
      '/api': {
        target: process.env.VITE_BACKEND_URL ?? 'http://localhost:8000',
        changeOrigin: true,
      },
      // Même relais pour la vidéo/les frames du tutoriel CH1 (voir
      // app/main.py) : le frontend reste sur des URLs relatives partout,
      // pas de logique séparée à connaître pour ce seul cas.
      '/media': {
        target: process.env.VITE_BACKEND_URL ?? 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})

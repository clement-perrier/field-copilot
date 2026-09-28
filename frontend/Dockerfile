# Dev-only : sert `vite dev` dans le conteneur pour que `docker compose up` lance
# aussi le frontend. Pas de build de production dans ce prototype (hors périmètre).
FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install

COPY . .

EXPOSE 5173

# --host est nécessaire pour que Vite écoute sur toutes les interfaces et soit
# joignable depuis l'extérieur du conteneur (sinon il n'écoute que 127.0.0.1).
CMD ["npm", "run", "dev", "--", "--host"]

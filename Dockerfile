FROM node:24-alpine AS app

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV NODE_ENV=production
ENV PORT=8080
ENV KOL_SELECTION_DB=/data/kol-selection.sqlite

RUN mkdir -p /data

EXPOSE 8080

CMD ["npm", "run", "start"]

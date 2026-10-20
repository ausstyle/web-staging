FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY src ./src
ENV NODE_ENV=production PORT=8787
USER node
EXPOSE 8787
CMD ["node","src/server.mjs"]

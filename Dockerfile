FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY db.mjs planner.mjs server.mjs sim.mjs sim.test.mjs ./
COPY public/ ./public/
USER node
RUN npm test
ENV HOST=0.0.0.0 PORT=4173 NODE_ENV=production
EXPOSE 4173
CMD ["node", "server.mjs"]

FROM node:22

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
COPY scripts/ ./scripts/

# Install production dependencies only
RUN npm install --omit=dev

# Copy application source
COPY . .

# Persistent data directory — mount a volume here in production to survive redeploys.
RUN mkdir -p /app/data
ENV DATA_DIR=/app/data

# Secrets are injected at RUNTIME via docker run -e / deployment platform.
# They are NOT baked into the image.

EXPOSE 3000

CMD ["node", "index.js"]

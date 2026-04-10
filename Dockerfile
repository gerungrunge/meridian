FROM node:22

WORKDIR /app

# Copy package files first for layer caching
COPY package.json package-lock.json ./
COPY scripts/ ./scripts/

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application source
COPY . .

# Secrets are injected at RUNTIME via docker run -e / deployment platform.
# They are NOT baked into the image.

EXPOSE 3000

CMD ["node", "index.js"]

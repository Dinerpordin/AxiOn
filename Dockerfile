# ---- Stage 1: Build the React/Vite frontend ----
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: Production backend + serve built frontend ----
FROM node:22-alpine AS runner
WORKDIR /app

# Copy backend dependencies and source
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./

# Copy built frontend into a "public" folder that the backend can serve
COPY --from=frontend-builder /app/frontend/dist ./public

# Cloud Run injects PORT env var; fall back to 8080
ENV API_BACKEND_PORT=8080
ENV API_BACKEND_HOST=0.0.0.0
EXPOSE 8080
CMD ["node", "server.js"]

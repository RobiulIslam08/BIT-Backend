# ============================================
# BIT SOFTWARE BACKEND — PRODUCTION DOCKERFILE
# ============================================

# Step 1: Build TypeScript to JavaScript
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Step 2: Production environment runner
FROM node:20-alpine AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# Persistent uploads (ZIP projects). Mount a Docker/Dokploy volume at /app/uploads
RUN mkdir -p /app/uploads/hosting-projects && chmod -R 755 /app/uploads
ENV NODE_ENV=production
ENV UPLOAD_DIR=/app/uploads
VOLUME ["/app/uploads"]

EXPOSE 5000
CMD ["npm", "run", "start:prod"]

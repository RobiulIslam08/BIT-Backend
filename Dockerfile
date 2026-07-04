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
ENV NODE_ENV=production
EXPOSE 5000
CMD ["npm", "run", "start:prod"]

# ---- build stage ----
FROM oven/bun:1.1 AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# DATABASE_URL is only needed at runtime; a placeholder satisfies prisma generate
ENV DATABASE_URL="file:/tmp/build-placeholder.db"
RUN bunx prisma generate && bun run build

# ---- runtime stage ----
FROM oven/bun:1.1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV DATABASE_URL="file:/app/db/custom.db"
ENV PORT=3000
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/prisma ./prisma
COPY --from=builder --chown=app:app /app/db ./db
COPY --from=builder --chown=app:app /app/data ./data
COPY --from=builder --chown=app:app /app/node_modules/.prisma ./node_modules/.prisma
RUN mkdir -p /app/db && chown -R app:app /app/db
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD bun -e "fetch('http://127.0.0.1:3000/api/health').then(r => r.ok ? process.exit(0) : process.exit(1)).catch(() => process.exit(1))"
CMD ["bun", ".next/standalone/server.js"]

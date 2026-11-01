# Build context: the repository root (the example imports the SDK it ships with).
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY examples ./examples
RUN pnpm build && pnpm example:build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# package.json stays beside dist/: the example imports the SDK by its package name.
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/examples/minimal/dist ./examples/minimal/dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD ["node", "-e", "fetch('http://127.0.0.1:3000/healthz').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "examples/minimal/dist/tsc/server/main.js"]

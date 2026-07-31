# Build context must be the repo root: docker build -f apps/api/Dockerfile .
FROM node:20-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/schema/package.json packages/schema/package.json
COPY packages/engine/package.json packages/engine/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY . .
RUN pnpm exec turbo run build --filter=@quorum/api...
RUN pnpm --filter @quorum/api exec prisma generate

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo ./
RUN chmod +x apps/api/docker-entrypoint.sh
WORKDIR /repo/apps/api
EXPOSE 3000
ENTRYPOINT ["./docker-entrypoint.sh"]

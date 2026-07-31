#!/bin/sh
set -e

echo "Running database migrations..."
node_modules/.bin/prisma migrate deploy --schema=./prisma/schema.prisma

echo "Starting API server..."
exec node dist/index.js

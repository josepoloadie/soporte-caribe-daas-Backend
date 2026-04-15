const { PrismaClient } = require('@prisma/client');

// Single shared instance — prevents connection pool exhaustion
const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
});

module.exports = prisma;
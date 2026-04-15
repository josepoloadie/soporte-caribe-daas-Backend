const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Sembrando usuarios...');

  await prisma.usuario.upsert({
    where: { email: 'admin@soportecaribe.com' },
    update: {},
    create: { nombre: 'Administrador', email: 'admin@soportecaribe.com', password_hash: await bcrypt.hash('admin123', 10), rol: 'ADMIN' }
  });

  await prisma.usuario.upsert({
    where: { email: 'tecnico@soportecaribe.com' },
    update: {},
    create: { nombre: 'Juan Martínez', email: 'tecnico@soportecaribe.com', password_hash: await bcrypt.hash('tecnico123', 10), rol: 'TECNICO' }
  });

  console.log('✅ Usuarios creados');

  // Equipo especial BODEGA — ubicación para componentes sin equipo asignado
  await prisma.equipo.upsert({
    where: { serial: 'BODEGA' },
    update: {},
    create: {
      serial:      'BODEGA',
      modelo:      'Bodega General',
      tipo_equipo: 'DESKTOP',
      cliente:     'Soporte Caribe LTDA',
      estado:      'COMPLETO',
      observaciones: 'Ubicación virtual para componentes en stock sin equipo asignado',
    }
  });
  console.log('✅ Equipo BODEGA creado');
  console.log('   admin@soportecaribe.com / admin123');
  console.log('   tecnico@soportecaribe.com / tecnico123');
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
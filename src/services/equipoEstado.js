const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

async function recalcularEstadoEquipo(equipoId, tx) {
  const db = tx || prisma
  const equipo = await db.equipo.findUnique({
    where: { id: equipoId },
    include: { componentes_actuales: { select: { estado: true } } }
  })

  if (!equipo || equipo.estado === 'BAJA') return

  const actuales = equipo.componentes_actuales
  const estados  = actuales.map(c => c.estado)
  let nuevoEstado

  if (actuales.length === 0) {
    nuevoEstado = 'INCOMPLETO'
  } else if (estados.some(e => e === 'DANADO' || e === 'EN_REVISION')) {
    nuevoEstado = 'CON_FALLAS'          // 🔴 rojo
  } else if (estados.some(e => e === 'EN_USO')) {
    nuevoEstado = 'PRESTADO'            // 🔵 azul
  } else if (estados.some(e => e === 'PENDIENTE_REPOSICION')) {
    nuevoEstado = 'PENDIENTE_REPOSICION' // 🟠 naranja
  } else if (estados.some(e => e === 'PENDIENTE_DEVOLUCION')) {
    nuevoEstado = 'PENDIENTE_DEVOLUCION' // 🟣 morado
  } else if (estados.every(e => e === 'BUENO')) {
    nuevoEstado = 'COMPLETO'            // 🟢 verde
  } else {
    nuevoEstado = 'INCOMPLETO'          // 🟡 amarillo
  }

  await db.equipo.update({
    where: { id: equipoId },
    data: { estado: nuevoEstado }
  })

  return nuevoEstado
}

module.exports = { recalcularEstadoEquipo }
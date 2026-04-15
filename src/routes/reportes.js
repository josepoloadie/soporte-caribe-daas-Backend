const router = require('express').Router();
const { PrismaClient } = require('@prisma/client');
const auth = require('../middleware/auth');
const prisma = new PrismaClient();

router.get('/dashboard', auth, async (req, res, next) => {
  try {
    const [totalEq, eqInc, eqPend, totalComp, compBueno, compUso, compDanado, compPDev, compPRep, movsAbiertos, repCamino] = await Promise.all([
      prisma.equipo.count(),
      prisma.equipo.count({ where: { estado: 'INCOMPLETO' } }),
      prisma.equipo.count({ where: { estado: 'PENDIENTE_REPOSICION' } }),
      prisma.componente.count(),
      prisma.componente.count({ where: { estado: 'BUENO' } }),
      prisma.componente.count({ where: { estado: 'EN_USO' } }),
      prisma.componente.count({ where: { estado: 'DANADO' } }),
      prisma.componente.count({ where: { estado: 'PENDIENTE_DEVOLUCION' } }),
      prisma.componente.count({ where: { estado: 'PENDIENTE_REPOSICION' } }),
      prisma.movimientoComponente.count({ where: { status: { notIn: ['CERRADO'] } } }),
      prisma.repuestoHp.count({ where: { estado: { in: ['EN_CAMINO', 'EN_TRANSITO'] } } }),
    ]);
    res.json({
      equipos: { total: totalEq, completos: totalEq - eqInc - eqPend, incompletos: eqInc, pendiente_reposicion: eqPend },
      componentes: { total: totalComp, disponibles: compBueno, en_uso: compUso, danados: compDanado, pendiente_devolucion: compPDev, pendiente_reposicion: compPRep },
      movimientos_abiertos: movsAbiertos,
      repuestos_en_camino: repCamino
    });
  } catch (err) { next(err); }
});

router.get('/pendientes-devolucion', auth, async (req, res, next) => {
  try {
    const data = await prisma.movimientoComponente.findMany({
      where: { uso_tipo: 'TEMPORAL', status: { notIn: ['CERRADO'] } },
      orderBy: { creado_en: 'asc' },
      include: { componente: true, origen: { select: { serial: true, modelo: true } }, destino: { select: { serial: true, modelo: true } }, usuario: { select: { nombre: true } } }
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/pendientes-reponer', auth, async (req, res, next) => {
  try {
    const data = await prisma.componente.findMany({
      where: { estado: 'PENDIENTE_REPOSICION' },
      include: { equipo_actual: { select: { serial: true, modelo: true } } }
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/donantes-incompletos', auth, async (req, res, next) => {
  try {
    const equipos = await prisma.equipo.findMany({
      where: { estado: { in: ['INCOMPLETO', 'PENDIENTE_REPOSICION'] } },
      include: {
        configuraciones: { orderBy: { fecha_consulta: 'desc' }, take: 1, include: { detalles: true } },
        componentes_actuales: { select: { part_number: true, estado: true } }
      }
    });
    const result = equipos.map(eq => {
      const config = eq.configuraciones[0]?.detalles || [];
      const actualesPNs = eq.componentes_actuales.map(c => c.part_number);
      return { ...eq, piezas_faltantes: config.filter(d => !actualesPNs.includes(d.part_number)) };
    });
    res.json(result);
  } catch (err) { next(err); }
});

router.get('/estatus-componentes', auth, async (req, res, next) => {
  try {
    const data = await prisma.componente.findMany({
      orderBy: [{ estado: 'asc' }, { categoria: 'asc' }],
      include: {
        equipo_actual: { select: { serial: true, modelo: true } },
        movimientos: { where: { status: 'ABIERTO' }, take: 1, select: { numero_caso: true, uso_tipo: true } }
      }
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/historial-componente/:id', auth, async (req, res, next) => {
  try {
    const data = await prisma.componente.findUnique({
      where: { id: req.params.id },
      include: {
        equipo_actual: true,
        movimientos: { orderBy: { creado_en: 'desc' }, include: { origen: { select: { serial: true } }, destino: { select: { serial: true } }, usuario: { select: { nombre: true } } } }
      }
    });
    if (!data) return res.status(404).json({ error: 'No encontrado' });
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/historial-equipo/:id', auth, async (req, res, next) => {
  try {
    const equipo = await prisma.equipo.findUnique({
      where: { id: req.params.id },
      include: {
        configuraciones: { orderBy: { fecha_consulta: 'desc' }, take: 1, include: { detalles: true } },
        componentes_actuales: true,
        movimientos_origen:  { orderBy: { creado_en: 'desc' }, include: { componente: true, usuario: { select: { nombre: true } } } },
        movimientos_destino: { orderBy: { creado_en: 'desc' }, include: { componente: true, usuario: { select: { nombre: true } } } },
      }
    });
    if (!equipo) return res.status(404).json({ error: 'No encontrado' });
    const historial = [
      ...equipo.movimientos_origen.map(m => ({ ...m, rol: 'origen' })),
      ...equipo.movimientos_destino.map(m => ({ ...m, rol: 'destino' }))
    ].sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en));
    res.json({ ...equipo, historial });
  } catch (err) { next(err); }
});

module.exports = router;
const router = require('express').Router();
const auth = require('../middleware/auth');
const { recalcularEstadoEquipo } = require('../services/equipoEstado');
const prisma = require('../db');

router.get('/buscar-compatible/:part_number', auth, async (req, res, next) => {
  try {
    const data = await prisma.componente.findMany({
      where: { part_number: { contains: req.params.part_number, mode: 'insensitive' }, estado: 'BUENO' },
      include: { equipo_actual: { select: { serial: true, modelo: true, estado: true } } }
    });
    
    
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/', auth, async (req, res, next) => {
  try {
    const { part_number, categoria, estado, ct } = req.query;
    const where = {};
    if (part_number) where.part_number = { contains: part_number, mode: 'insensitive' };
    if (categoria)   where.categoria   = categoria;
    if (estado)      where.estado      = estado;
    if (ct)          where.ct          = { contains: ct, mode: 'insensitive' };
    const data = await prisma.componente.findMany({
      where, orderBy: { creado_en: 'desc' },
      include: { equipo_actual: { select: { serial: true, modelo: true } } }
    });
    
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:id', auth, async (req, res, next) => {
  
  try {
    const data = await prisma.componente.findUnique({
      where: { id: req.params.id },
      include: {
        equipo_actual: true,
        movimientos: {
          orderBy: { creado_en: 'desc' },
          include: { origen: { select: { serial: true, modelo: true } }, destino: { select: { serial: true, modelo: true } }, usuario: { select: { nombre: true } } }
        },
        historial_ct: { orderBy: { creado_en: 'desc' } }
      }
    });
    if (!data) return res.status(404).json({ error: 'Componente no encontrado' });
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { part_number, descripcion, categoria, ct, estado, equipo_actual_id, observaciones, numero_os } = req.body;
    if (!part_number || !descripcion || !categoria)
      return res.status(400).json({ error: 'part_number, descripcion y categoria son requeridos' });
    const data = await prisma.componente.create({
      data: { part_number, descripcion, categoria, ct, estado, equipo_actual_id, observaciones, numero_os }
    });
    if (data.equipo_actual_id) await recalcularEstadoEquipo(data.equipo_actual_id);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    const { descripcion, categoria, ct, estado, equipo_actual_id, observaciones, numero_os } = req.body;
    const data = { descripcion, categoria, ct, estado, observaciones };
    if (equipo_actual_id !== undefined) {
      data.equipo_actual_id = equipo_actual_id ? equipo_actual_id : null;
    }
    Object.keys(data).forEach(k => data[k] === undefined && delete data[k]);
    const result = await prisma.componente.update({
      where: { id: req.params.id },
      data
    });
    // Recalcular estado del equipo automáticamente
    if (result.equipo_actual_id) {
      await recalcularEstadoEquipo(result.equipo_actual_id);
    }
    res.json(result);
  } catch (err) { next(err); }
});

module.exports = router;

// DELETE /api/componentes/:id — solo si no tiene movimientos
router.delete('/:id', auth, async (req, res, next) => {
  try {
    const movs = await prisma.movimientoComponente.count({ where: { componente_id: req.params.id } })
    if (movs > 0)
      return res.status(409).json({ error: `No se puede eliminar: tiene ${movs} movimiento(s) registrado(s)` })
    const comp = await prisma.componente.findUnique({ where: { id: req.params.id } })
    await prisma.componente.delete({ where: { id: req.params.id } })
    if (comp?.equipo_actual_id) await recalcularEstadoEquipo(comp.equipo_actual_id)
    res.json({ ok: true })
  } catch (err) { next(err) }
})
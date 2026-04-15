const router = require('express').Router();
const auth = require('../middleware/auth');
const { recalcularEstadoEquipo } = require('../services/equipoEstado');
const prisma = require('../db');

const include = {
  componente: { select: { part_number: true, descripcion: true, categoria: true, ct: true } },
  origen:     { select: { id: true, serial: true, modelo: true } },
  destino:    { select: { id: true, serial: true, modelo: true } },
  usuario:    { select: { nombre: true } }
};

router.get('/', auth, async (req, res, next) => {
  try {
    const { numero_caso, status, uso_tipo } = req.query;
    const where = {};
    if (numero_caso) where.numero_caso = { contains: numero_caso, mode: 'insensitive' };
    if (status)      where.status      = status;
    if (uso_tipo)    where.uso_tipo    = uso_tipo;
    const data = await prisma.movimientoComponente.findMany({
      where, orderBy: { creado_en: 'desc' }, include
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const data = await prisma.movimientoComponente.findUnique({
      where: { id: req.params.id },
      include: { ...include, origen: true, destino: true }
    });
    if (!data) return res.status(404).json({ error: 'Movimiento no encontrado' });
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const {
      componente_id, equipo_completo,
      origen_id, uso_tipo, fecha_entrega
    } = req.body;
    const numero_caso  = sanitize(req.body.numero_caso, 100);
    const tecnico      = sanitize(req.body.tecnico, 100);
    const ct_bueno     = sanitize(req.body.ct_bueno, 50);
    const observaciones = sanitize(req.body.observaciones, 500);

    if (!numero_caso) return res.status(400).json({ error: 'El caso DAAS es requerido' });
    if (!origen_id)   return res.status(400).json({ error: 'El equipo origen es requerido' });
    if (!tecnico)     return res.status(400).json({ error: 'El técnico es requerido' });
    if (!equipo_completo && !componente_id)
      return res.status(400).json({ error: 'Selecciona un componente o marca equipo completo' });
    if (!equipo_completo && !ct_bueno)
      return res.status(400).json({ error: 'El CT del componente es obligatorio' });

    const createData = {
      componente_id:   componente_id  || null,
      equipo_completo: !!equipo_completo,
      numero_caso,
      tipo_movimiento: 'INSTALACION',
      origen_id:       origen_id      || null,
      destino_id:      null,
      uso_tipo:        uso_tipo       || 'TEMPORAL',
      tecnico,
      ct_bueno:        ct_bueno       || null,
      fecha_entrega:   fecha_entrega ? new Date(fecha_entrega) : new Date(),
      status:          'ENTREGADO',
      usuario_id:      req.user.id,
      observaciones:   observaciones  || null
    }

    const mov = await prisma.movimientoComponente.create({ data: createData });

    // Actualizar estado componente y registrar CT en historial
    if (componente_id) {
      await prisma.componente.update({
        where: { id: componente_id },
        data: { estado: 'EN_USO', ...(ct_bueno ? { ct: ct_bueno } : {}) }
      });
      // Registrar CT inicial en historial
      if (ct_bueno) {
        await prisma.historialCT.create({
          data: { componente_id, ct: ct_bueno, motivo: `Entregado al técnico — Caso ${numero_caso}`, movimiento_id: mov.id }
        });
      }
    }

    // Si equipo completo, marcar como PRESTADO
    if (equipo_completo) {
      await prisma.equipo.update({ where: { id: origen_id }, data: { estado: 'PRESTADO' } });
    } else {
      await recalcularEstadoEquipo(origen_id);
    }

    const data = await prisma.movimientoComponente.findUnique({ where: { id: mov.id }, include });
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PUT /:id/estado — avanzar estado
router.put('/:id/estado', auth, async (req, res, next) => {
  try {
    const { status, ct_malo, ct_bueno_hp, fecha_instalacion, fecha_devolucion, observaciones } = req.body;
    const mov = await prisma.movimientoComponente.findUnique({ where: { id: req.params.id } });
    if (!mov) return res.status(404).json({ error: 'Movimiento no encontrado' });

    const updateData = { status };
    if (observaciones)     updateData.observaciones     = observaciones;
    if (ct_malo)           updateData.ct_malo           = ct_malo;
    if (fecha_instalacion) updateData.fecha_instalacion = new Date(fecha_instalacion);
    if (fecha_devolucion)  updateData.fecha_devolucion  = new Date(fecha_devolucion);

    await prisma.movimientoComponente.update({ where: { id: req.params.id }, data: updateData });

    if (mov.componente_id) {
      let nuevoEstadoComp = null;
      if (status === 'INSTALADO')            nuevoEstadoComp = 'EN_USO';
      if (status === 'EN_ESPERA')            nuevoEstadoComp = 'PENDIENTE_REPOSICION';
      if (status === 'PENDIENTE_DEVOLUCION') nuevoEstadoComp = 'PENDIENTE_DEVOLUCION';
      if (status === 'CERRADO') {
        nuevoEstadoComp = 'BUENO';
        await prisma.componente.update({
          where: { id: mov.componente_id },
          data: { estado: nuevoEstadoComp, equipo_actual_id: mov.origen_id }
        });
      } else if (nuevoEstadoComp) {
        // Si EN_ESPERA y viene CT del repuesto HP, actualizar CT del componente
        const updateData = { estado: nuevoEstadoComp };
        if (status === 'EN_ESPERA' && ct_bueno_hp) {
          updateData.ct = ct_bueno_hp;
        }
        await prisma.componente.update({ where: { id: mov.componente_id }, data: updateData });

        // Registrar nuevo CT en historial si cambió
        if (status === 'EN_ESPERA' && ct_bueno_hp) {
          await prisma.historialCT.create({
            data: {
              componente_id: mov.componente_id,
              ct: ct_bueno_hp,
              motivo: `Repuesto HP instalado en donante — Caso ${mov.numero_caso}`,
              movimiento_id: req.params.id
            }
          });
        }
      }
    }

    // Si EN_ESPERA, avanzar automáticamente a PENDIENTE_DEVOLUCION
    if (status === 'EN_ESPERA') {
      await prisma.movimientoComponente.update({
        where: { id: req.params.id },
        data: { status: 'PENDIENTE_DEVOLUCION' }
      });
    }

    if (mov.equipo_completo && status === 'CERRADO' && mov.origen_id) {
      await prisma.equipo.update({ where: { id: mov.origen_id }, data: { estado: 'COMPLETO' } });
    }

    if (mov.origen_id && !mov.equipo_completo) await recalcularEstadoEquipo(mov.origen_id);

    const data = await prisma.movimientoComponente.findUnique({ where: { id: req.params.id }, include });
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
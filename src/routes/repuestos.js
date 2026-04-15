const router = require('express').Router();
const prisma = require('../db');
const auth = require('../middleware/auth');

router.get('/', auth, async (req, res, next) => {
  try {
    const { estado, numero_caso } = req.query;
    const where = {};
    if (estado)      where.estado      = estado;
    if (numero_caso) where.numero_caso = { contains: numero_caso, mode: 'insensitive' };
    const data = await prisma.repuestoHp.findMany({ where, orderBy: { creado_en: 'desc' } });
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { numero_caso, equipo_destino_id, componente_id, part_number, descripcion, estado } = req.body;
    if (!numero_caso || !part_number) return res.status(400).json({ error: 'numero_caso y part_number son requeridos' });
    const data = await prisma.repuestoHp.create({
      data: { numero_caso, part_number, descripcion, estado: estado || 'EN_CAMINO',
        equipo_destino_id: equipo_destino_id ? equipo_destino_id : null,
        componente_id:     componente_id     ? componente_id     : null }
    });
    res.status(201).json(data);
  } catch (err) { next(err); }
});

router.put('/:id/recibir', auth, async (req, res, next) => {
  try {
    const data = await prisma.repuestoHp.update({ where: { id: req.params.id }, data: { estado: 'RECIBIDO', fecha_recepcion: new Date() } });
    res.json(data);
  } catch (err) { next(err); }
});

router.put('/:id/instalar', auth, async (req, res, next) => {
  try {
    const rep = await prisma.repuestoHp.update({ where: { id: req.params.id }, data: { estado: 'INSTALADO', fecha_instalacion: new Date() } });
    if (rep.equipo_destino_id)
      await prisma.equipo.update({ where: { id: rep.equipo_destino_id }, data: { estado: 'COMPLETO' } });
    res.json(rep);
  } catch (err) { next(err); }
});

module.exports = router;
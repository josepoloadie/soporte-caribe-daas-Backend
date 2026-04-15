const router = require('express').Router();
const prisma = require('../db');
const auth = require('../middleware/auth');

const include = {
  configuraciones: { orderBy: { fecha_consulta: 'desc' }, take: 1, include: { detalles: true } },
  componentes_actuales: { select: { id: true, part_number: true, descripcion: true, categoria: true, ct: true, estado: true, numero_os:true } }
};

// POST /api/equipos/recalcular-todos
router.post('/recalcular-todos', auth, async (req, res, next) => {
  try {
    const { recalcularEstadoEquipo } = require('../services/equipoEstado')
    const equipos = await prisma.equipo.findMany({ where: { estado: { not: 'BAJA' } }, select: { id: true } })
    const resultados = []
    for (const eq of equipos) {
      const estado = await recalcularEstadoEquipo(eq.id)
      resultados.push({ id: eq.id, estado })
    }
    res.json({ recalculados: resultados.length, resultados })
  } catch (err) { next(err) }
})

// POST /api/equipos/importar-masivo — crear equipos en BD
router.post('/importar-masivo', auth, async (req, res, next) => {
  try {
    const { equipos: rows } = req.body
    if (!rows?.length) return res.status(400).json({ error: 'No hay equipos para importar' })
    const creados = [], errores = []
    for (const row of rows) {
      try {
        const eq = await prisma.equipo.create({
          data: {
            serial:         row.serial.toUpperCase(),
            modelo:         row.modelo || 'Sin modelo',
            product_number: row.product_number || null,
            tipo_equipo:    ['LAPTOP','DESKTOP','AIO','MONITOR','IMPRESORA'].includes(row.tipo_equipo) ? row.tipo_equipo : 'LAPTOP',
            cliente:        row.cliente || null,
            estado:         'INCOMPLETO',
          }
        })
        creados.push(eq)
      } catch (err) {
        errores.push({ serial: row.serial, error: err.code === 'P2002' ? 'Serial duplicado' : err.message })
      }
    }
    res.status(201).json({ creados: creados.length, errores })
  } catch (err) { next(err) }
})

// POST /api/equipos/importar-job — crear job de importación PS
router.post('/importar-job', auth, async (req, res) => {
  const { seriales } = req.body
  if (!seriales?.length) return res.status(400).json({ error: 'No hay seriales' })
  const { crearJob } = require('../services/importJob')
  const jobId = crearJob(seriales)
  res.json({ jobId })
})

// POST /api/equipos/importar-seleccion — responder selección de product number
router.post('/importar-seleccion', auth, async (req, res) => {
  const { jobId, serial, productNumber } = req.body
  if (!jobId || !serial || !productNumber) return res.status(400).json({ error: 'Faltan datos' })
  const { setSeleccion } = require('../services/importJob')
  setSeleccion(jobId, serial, productNumber)
  res.json({ ok: true })
})

// GET /api/equipos/importar-partsurfer — SSE
// Note: token via query param required because EventSource doesn't support headers
// Token is only accepted from localhost/same-origin in production setup
router.get('/importar-partsurfer', async (req, res) => {
  const token = req.query.token
  if (!token) { res.status(401).end(); return }
  let jwtUser
  try {
    const jwt = require('jsonwebtoken')
    jwtUser = jwt.verify(token, process.env.JWT_SECRET)
  } catch { res.status(401).end(); return }
  // Prevent token reuse after expiry check already done above
  if (!jwtUser?.id) { res.status(401).end(); return }

  const { jobId, desde } = req.query
  if (!jobId) { res.status(400).end(); return }

  const { getJob, eliminarJob } = require('../services/importJob')
  const job = getJob(jobId)
  if (!job) { res.status(404).end(); return }

  const desdeIdx = parseInt(desde) || 0
  const lista = job.seriales.slice(desdeIdx)

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`)
  const puppeteer = require('puppeteer')

  function inferirCategoria(desc) {
    const d = (desc || '').toLowerCase()
    if (d.includes('ssd') || d.includes('solid state') || d.includes('nvme') || d.includes('hard drive') || d.includes('sata')) return 'SSD'
    if (d.includes('memory') || d.includes('ram') || d.includes('ddr') || d.includes('sodimm') || d.includes('dimm')) return 'RAM'
    if (d.includes('display') || d.includes('lcd') || d.includes('panel') || d.includes('screen') || d.includes('raw panel') || d.includes('bezel')) return 'PANTALLA'
    if (d.includes('battery') || d.includes('batt')) return 'BATERIA'
    if (d.includes('board') || d.includes('motherboard') || d.includes('system board') || d.includes('sps-mb')) return 'BOARD'
    if (d.includes('keyboard') || d.includes('kb') || d.includes('top cover') || d.includes('teclado')) return 'TECLADO'
    return 'OTRO'
  }

  async function extraerPartes(page) {
    return page.evaluate(() => {
      const results = []
      document.querySelectorAll('table.table tbody tr').forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'))
        if (cells.length >= 5) {
          const pn   = cells[3]?.textContent?.trim()
          const desc = cells[4]?.querySelector('div')?.textContent?.trim() || cells[4]?.textContent?.trim()
          if (pn && desc && /^[A-Z0-9]{3,}-[0-9]{3,}/.test(pn) && desc.length > 2)
            results.push({ part_number: pn, descripcion: desc })
        }
      })
      return results
    })
  }

  async function extraerHeader(page) {
    return page.evaluate(() => {
      let modelo = '', product_number = ''
      const headerDiv = Array.from(document.querySelectorAll('div')).find(d => d.style.backgroundColor === 'rgb(0, 150, 214)')
      if (headerDiv) {
        headerDiv.innerText.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
          if (line.includes('Product Number')) product_number = line.split(':').pop().trim()
          if (line.includes('Description'))    modelo        = line.split(':').pop().trim()
        })
      }
      return { modelo, product_number }
    })
  }

  async function guardarConfig(eq, parts, modelo, product_number) {
    const updateData = {}
    if (modelo && eq.modelo === 'Sin modelo') updateData.modelo = modelo
    if (product_number && !eq.product_number) updateData.product_number = product_number
    if (Object.keys(updateData).length) await prisma.equipo.update({ where: { id: eq.id }, data: updateData })
    const configExistente = await prisma.configuracionOriginal.findFirst({ where: { equipo_id: eq.id } })
    if (configExistente) {
      await prisma.configuracionOriginalDetalle.deleteMany({ where: { configuracion_id: configExistente.id } })
      await prisma.configuracionOriginal.delete({ where: { id: configExistente.id } })
    }
    await prisma.configuracionOriginal.create({
      data: {
        equipo_id: eq.id,
        raw_data:  { partes: parts },
        detalles:  { create: parts.map(p => ({ part_number: p.part_number, descripcion: p.descripcion, categoria: inferirCategoria(p.descripcion) })) }
      }
    })
  }

  let ok = 0, sinPartes = 0, errores = 0

  for (let i = 0; i < lista.length; i++) {
    const serial  = lista[i]
    const idxGlobal = desdeIdx + i
    send({ tipo: 'procesando', serial, index: idxGlobal + 1, total: job.seriales.length })

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    })
    try {
      const eq = await prisma.equipo.findFirst({ where: { serial: serial.toUpperCase() } })
      if (!eq) { send({ tipo: 'error', serial, mensaje: 'No encontrado en BD' }); errores++; await browser.close(); continue }

      const page = await browser.newPage()
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36')
      await page.setViewport({ width: 1280, height: 900 })

      // Si tiene selección previa, buscar directamente por product number
      const seleccionPN = job.selecciones[serial]
      const busqueda = seleccionPN || eq.product_number || serial

      await page.goto(`https://partsurfer.hp.com/?searchtext=${encodeURIComponent(busqueda)}`, { waitUntil: 'networkidle0', timeout: 45000 })
      await new Promise(r => setTimeout(r, 2000))

      // Detectar select múltiple (solo si no hubo selección previa)
      if (!seleccionPN && !eq.product_number) {
        const opciones = await page.evaluate(() => {
          const select = document.querySelector('select[name="productsnrlists"]')
          if (!select) return null
          return Array.from(select.options)
            .filter(o => o.value && !o.value.toLowerCase().includes('please'))
            .map(o => ({ value: o.value, label: o.textContent.trim() }))
        })
        if (opciones && opciones.length > 0) {
          send({ tipo: 'seleccion_requerida', serial, opciones, jobId, desde: idxGlobal })
          await browser.close()
          res.end()
          return
        }
      }

      // Clic en pestaña General
      await page.evaluate(() => {
        const tab = Array.from(document.querySelectorAll('li[role="tab"]')).find(t => t.textContent.toLowerCase().includes('general'))
        if (tab) tab.click()
      })
      await new Promise(r => setTimeout(r, 3000))

      const { modelo, product_number } = await extraerHeader(page)
      const parts = await extraerPartes(page)

      if (parts.length > 0) {
        await guardarConfig(eq, parts, modelo, seleccionPN || product_number)
        ok++
        send({ tipo: 'ok', serial, partes: parts.length, modelo: modelo || eq.modelo })
      } else {
        sinPartes++
        send({ tipo: 'sin_partes', serial, mensaje: 'Sin partes en PartSurfer' })
      }
    } catch (err) { errores++; send({ tipo: 'error', serial, mensaje: err.message }) }
    finally { try { await browser.close() } catch {} }
  }

  send({ tipo: 'fin', ok, sin_partes: sinPartes, errores, total: job.seriales.length })
  eliminarJob(jobId)
  res.end()
})

router.get('/', auth, async (req, res, next) => {

  try {
    const { serial, modelo, estado, cliente, tipo_equipo } = req.query;
    const where = {};
    if (serial)      where.serial      = { contains: serial,  mode: 'insensitive' };
    if (modelo)      where.modelo      = { contains: modelo,  mode: 'insensitive' };
    if (cliente)     where.cliente     = { contains: cliente, mode: 'insensitive' };
    if (estado)      where.estado      = estado;
    if (tipo_equipo) where.tipo_equipo = tipo_equipo;
    const data = await prisma.equipo.findMany({ where, orderBy: { creado_en: 'desc' }, include });
    res.json(data);
  } catch (err) { next(err); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const data = await prisma.equipo.findUnique({
      where: { id: req.params.id },
      include: {
        ...include,
        movimientos_origen:  { include: { componente: true, usuario: { select: { nombre: true } } }, orderBy: { creado_en: 'desc' } },
        movimientos_destino: { include: { componente: true, usuario: { select: { nombre: true } } }, orderBy: { creado_en: 'desc' } },
      }
    });
    if (!data) return res.status(404).json({ error: 'Equipo no encontrado' });   
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { serial, modelo, product_number, tipo_equipo, cliente, estado, observaciones } = req.body;
    if (!serial || !modelo || !tipo_equipo)
      return res.status(400).json({ error: 'serial, modelo y tipo_equipo son requeridos' });
    const data = await prisma.equipo.create({
      data: { serial: serial.toUpperCase(), modelo, product_number, tipo_equipo, cliente, estado: estado || 'COMPLETO', observaciones }
    });
    res.status(201).json(data);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Ya existe un equipo con ese serial' });
    next(err);
  }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    const { modelo, product_number, tipo_equipo, cliente, estado, observaciones } = req.body;
    const data = await prisma.equipo.update({
      where: { id: req.params.id },
      data: { modelo, product_number, tipo_equipo, cliente, estado, observaciones }
    });
    res.json(data);
  } catch (err) { next(err); }
});

router.post('/:id/configuracion', auth, async (req, res, next) => {
  try {
    const { raw_data, detalles } = req.body
    const configExistente = await prisma.configuracionOriginal.findFirst({ where: { equipo_id: req.params.id } })
    if (configExistente) {
      await prisma.configuracionOriginalDetalle.deleteMany({ where: { configuracion_id: configExistente.id } })
      await prisma.configuracionOriginal.delete({ where: { id: configExistente.id } })
    }
    const data = await prisma.configuracionOriginal.create({
      data: { equipo_id: req.params.id, raw_data, detalles: { create: detalles } },
      include: { detalles: true }
    })
    res.status(201).json(data)
  } catch (err) { next(err) }
})

router.put('/:id/archivar', auth, async (req, res, next) => {
  try {
    const data = await prisma.equipo.update({ where: { id: req.params.id }, data: { estado: 'BAJA' } });
    res.json(data);
  } catch (err) { next(err); }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    const compActivos = await prisma.componente.count({
      where: { equipo_actual_id: req.params.id, estado: { notIn: ['DANADO','PENDIENTE_REPOSICION'] } }
    });
    if (compActivos > 0)
      return res.status(409).json({ error: `No se puede eliminar: el equipo tiene ${compActivos} componente(s) activo(s). Retíralos primero.` });
    await prisma.repuestoHp.deleteMany({ where: { equipo_destino_id: req.params.id } });
    await prisma.componente.deleteMany({ where: { equipo_actual_id: req.params.id } });
    await prisma.$transaction([
      prisma.configuracionOriginalDetalle.deleteMany({ where: { configuracion: { equipo_id: req.params.id } } }),
      prisma.configuracionOriginal.deleteMany({ where: { equipo_id: req.params.id } }),
      prisma.equipo.delete({ where: { id: req.params.id } })
    ]);
    res.json({ ok: true, mensaje: 'Equipo eliminado permanentemente' });
  } catch (err) { next(err); }
});

module.exports = router;
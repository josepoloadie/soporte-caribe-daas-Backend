const router = require('express').Router();
const auth = require('../middleware/auth');
const puppeteer = require('puppeteer');

function inferirCategoria(desc) {
  const d = desc.toLowerCase();
  if (d.includes('ssd') || d.includes('solid state') || d.includes('nvme') || d.includes('hard drive') || d.includes('sata')) return 'SSD';
  if (d.includes('memory') || d.includes('ram') || d.includes('ddr') || d.includes('sodimm') || d.includes('dimm')) return 'RAM';
  if (d.includes('display') || d.includes('lcd') || d.includes('panel') || d.includes('screen') || d.includes('raw panel') || d.includes('bezel')) return 'PANTALLA';
  if (d.includes('battery') || d.includes('batt') || d.includes('bateria')) return 'BATERIA';
  if (d.includes('board') || d.includes('motherboard') || d.includes('system board') || d.includes('sps-mb')) return 'BOARD';
  if (d.includes('keyboard') || d.includes('kb') || d.includes('top cover') || d.includes('teclado')) return 'TECLADO';
  return 'OTRO';
}

async function scrapPartSurfer(serial) {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  try {
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    await page.setViewport({ width: 1280, height: 900 });

    const url = `https://partsurfer.hp.com/?searchtext=${encodeURIComponent(serial)}`;
    console.log('Consultando:', url);

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2000));

    // Detectar si hay un select de producto (serial aplica a varios modelos)
    const opciones = await page.evaluate(() => {
      const select = document.querySelector('select[name="productsnrlists"]');
      if (!select) return null;
      return Array.from(select.options)
        .filter(o => o.value && o.value !== 'Please Select a Product Number' && !o.value.toLowerCase().includes('please'))
        .map(o => ({ value: o.value, label: o.textContent.trim() }));
    });

    console.log('Select detectado:', opciones ? `${opciones.length} opciones` : 'NO')
    if (opciones) console.log('Opciones:', JSON.stringify(opciones))

    if (opciones && opciones.length > 0) {
      // Retornar opciones para que el usuario elija
      return {
        serial: serial.toUpperCase(),
        requiere_seleccion: true,
        opciones,
        modelo: null, product_number: null, partes: []
      };
    }

    // Clic en la pestaña "General(Product Family)" usando el selector exacto de react-tabs
    console.log('Buscando pestaña General(Product Family)...');
    const tabClicked = await page.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll('li[role="tab"]'));
      const tab  = tabs.find(t => t.textContent.trim().toLowerCase().includes('general'));
      if (tab) { tab.click(); return tab.textContent.trim(); }
      return null;
    });

    console.log('Pestaña clickeada:', tabClicked);
    await new Promise(r => setTimeout(r, 3000)); // esperar que cargue el contenido

    // Obtener modelo y product number del encabezado azul de PartSurfer
    const { modelo, product_number } = await page.evaluate(() => {
      let modelo = '';
      let product_number = '';

      // El encabezado azul tiene style="background-color: rgb(0, 150, 214)"
      const allDivs = Array.from(document.querySelectorAll('div'));
      const headerDiv = allDivs.find(d => d.style.backgroundColor === 'rgb(0, 150, 214)');

      if (headerDiv) {
        const lines = headerDiv.innerText.split('\n').map(l => l.trim()).filter(Boolean);
        lines.forEach(line => {
          if (line.includes('Product Number')) {
            product_number = line.split(':').pop().trim();
          }
          if (line.includes('Description')) {
            modelo = line.split(':').pop().trim();
          }
        });
      }

      return { modelo, product_number };
    });
    console.log('Modelo:', modelo);
    console.log('Product Number:', product_number);

    // Extraer partes: Part Number está en td índice 3 (Photo, AddToCart, ClickToBuy, PartNumber, Description...)
    const parts = await page.evaluate(() => {
      const results = [];
      document.querySelectorAll('table.table tbody tr').forEach(row => {
        const cells = Array.from(row.querySelectorAll('td'));
        if (cells.length >= 5) {
          const pn   = cells[3]?.textContent?.trim(); // columna Part Number
          const desc = cells[4]?.querySelector('div')?.textContent?.trim() || cells[4]?.textContent?.trim(); // columna Part Description
          if (pn && desc && /^[A-Z0-9]{3,}-[0-9]{3,}/.test(pn) && desc.length > 2) {
            results.push({ part_number: pn, descripcion: desc });
          }
        }
      });
      return results;
    });

    console.log('Partes encontradas:', parts.length);

    return {
      serial: serial.toUpperCase(),
      modelo,
      product_number,
      partes: parts.map(p => ({ ...p, categoria: inferirCategoria(p.descripcion) })),
      consultado_en: new Date().toISOString()
    };

  } finally {
    await browser.close();
  }
}

// GET /api/partsurfer/parte?pn=L85366-005
router.get('/parte', auth, async (req, res, next) => {
  try {
    const part_number = req.query.pn
    if (!part_number || part_number.length < 4) return res.status(400).json({ error: 'Número de parte inválido' })
    console.log('Buscando parte:', part_number)

    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    const enBD = await prisma.configuracionOriginalDetalle.findFirst({
      where: { part_number: { contains: part_number, mode: 'insensitive' } }
    })
    console.log('En BD:', enBD)
    if (enBD) {
      return res.json({ part_number: enBD.part_number, descripcion: enBD.descripcion, categoria: enBD.categoria, fuente: 'bd' })
    }

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    })
    try {
      const page = await browser.newPage()
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36')
      await page.goto(`https://partsurfer.hp.com/?searchtext=${encodeURIComponent(part_number)}`, { waitUntil: 'networkidle0', timeout: 30000 })
      await new Promise(r => setTimeout(r, 2000))

      const result = await page.evaluate((pn) => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'))
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'))
          if (cells.length >= 4) {
            // Cuando busca por parte: Photo(0), AddToCart(1), PartNumber(2), Description(3)
            const cellPN   = cells[2]?.textContent?.trim()
            const cellDesc = cells[3]?.querySelector('div')?.textContent?.trim() || cells[3]?.textContent?.trim()
            if (cellPN && cellPN.toUpperCase() === pn.toUpperCase() && cellDesc) {
              return { part_number: cellPN, descripcion: cellDesc }
            }
          }
        }
        return null
      }, part_number)
      if (result) return res.json({ ...result, categoria: inferirCategoria(result.descripcion), fuente: 'partsurfer' })
      res.status(404).json({ error: 'Número de parte no encontrado en PartSurfer' })
    } finally {
      await browser.close()
    }
  } catch (err) {
    next(new Error('Error buscando número de parte: ' + err.message))
  }
})

// GET /api/partsurfer/seleccionar?serial=XXX&product_number=YYY
// Busca directamente por product number para obtener las partes exactas del modelo
router.get('/seleccionar', auth, async (req, res, next) => {
  try {
    const { serial, product_number } = req.query
    if (!serial || !product_number) return res.status(400).json({ error: 'serial y product_number requeridos' })

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    })
    try {
      const page = await browser.newPage()
      await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36')
      await page.setViewport({ width: 1280, height: 900 })

      // Buscar directamente por product number
      console.log(`Buscando por product number: ${product_number}`)
      await page.goto(`https://partsurfer.hp.com/?searchtext=${encodeURIComponent(product_number)}`, { waitUntil: 'networkidle0', timeout: 45000 })
      await new Promise(r => setTimeout(r, 3000))

      // Clic en pestaña General
      await page.evaluate(() => {
        const tab = Array.from(document.querySelectorAll('li[role="tab"]')).find(t => t.textContent.toLowerCase().includes('general'))
        if (tab) tab.click()
      })
      await new Promise(r => setTimeout(r, 3000))

      // Extraer info del encabezado azul
      const { modelo, pn } = await page.evaluate(() => {
        let modelo = '', pn = ''
        const headerDiv = Array.from(document.querySelectorAll('div')).find(d => d.style.backgroundColor === 'rgb(0, 150, 214)')
        if (headerDiv) {
          headerDiv.innerText.split('\n').map(l => l.trim()).filter(Boolean).forEach(line => {
            if (line.includes('Product Number')) pn = line.split(':').pop().trim()
            if (line.includes('Description'))    modelo = line.split(':').pop().trim()
          })
        }
        return { modelo, pn }
      })

      // Extraer partes
      const parts = await page.evaluate(() => {
        const results = []
        document.querySelectorAll('table.table tbody tr').forEach(row => {
          const cells = Array.from(row.querySelectorAll('td'))
          if (cells.length >= 5) {
            const partNum = cells[3]?.textContent?.trim()
            const desc    = cells[4]?.querySelector('div')?.textContent?.trim() || cells[4]?.textContent?.trim()
            if (partNum && desc && /^[A-Z0-9]{3,}-[0-9]{3,}/.test(partNum) && desc.length > 2)
              results.push({ part_number: partNum, descripcion: desc })
          }
        })
        return results
      })

      console.log(`Partes encontradas para ${product_number}:`, parts.length)

      if (!parts.length) {
        return res.status(404).json({ error: 'No se encontraron componentes para este producto.' })
      }

      res.json({
        serial: serial.toUpperCase(),
        modelo,
        product_number: pn || product_number,
        partes: parts.map(p => ({ ...p, categoria: inferirCategoria(p.descripcion) })),
        consultado_en: new Date().toISOString()
      })
    } finally { await browser.close() }
  } catch (err) { next(new Error('Error: ' + err.message)) }
})


// POST /api/partsurfer/consultar — alias para compatibilidad frontend
router.post('/consultar', auth, async (req, res, next) => {
  const { serial } = req.body
  if (!serial) return res.status(400).json({ error: 'Serial requerido' })
  req.params = { serial }
  // Reusar la lógica del GET /:serial
  try {
    const data = await scrapPartSurfer(serial)
    res.json(data)
  } catch (err) { next(err) }
})

// POST /api/partsurfer/seleccionar — alias para compatibilidad frontend
router.post('/seleccionar', auth, async (req, res, next) => {
  const { serial, productNumber } = req.body
  if (!serial || !productNumber) return res.status(400).json({ error: 'Serial y productNumber requeridos' })
  req.query = { serial, product_number: productNumber }
  try {
    // Redirect to GET /seleccionar logic
    const mockReq = { query: { serial, product_number: productNumber }, headers: req.headers }
    const mockRes = { json: (d) => res.json(d), status: (c) => ({ json: (d) => res.status(c).json(d) }) }
    // Call seleccionar handler inline - simpler to just duplicate the scrape
    const data = await scrapPartSurfer(productNumber)
    res.json(data)
  } catch (err) { next(err) }
})

router.get('/:serial', auth, async (req, res, next) => {
  try {
    const { serial } = req.params;
    if (!serial || serial.length < 5) return res.status(400).json({ error: 'Serial inválido' });
    const data = await scrapPartSurfer(serial.toUpperCase());

    // Si requiere selección de producto, retornar opciones al frontend
    if (data.requiere_seleccion) {
      return res.json(data);
    }

    if (!data.partes?.length) {
      return res.status(404).json({
        error: 'No se encontraron componentes para este serial.',
        serial: serial.toUpperCase(),
        modelo: data.modelo || null
      });
    }
    res.json(data);
  } catch (err) {
    console.error('PartSurfer error:', err.message);
    next(new Error('Error consultando HP PartSurfer: ' + err.message));
  }
});

module.exports = router;
// Cola de jobs de importación en memoria
const jobs = {}

function crearJob(seriales) {
  const id = Date.now().toString()
  jobs[id] = { seriales, pendientes: [...seriales], selecciones: {}, activo: true }
  return id
}

function getJob(id) { return jobs[id] }

function setSeleccion(id, serial, productNumber) {
  if (jobs[id]) jobs[id].selecciones[serial] = productNumber
}

function eliminarJob(id) { delete jobs[id] }

module.exports = { crearJob, getJob, setSeleccion, eliminarJob }
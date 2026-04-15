require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
let rateLimit;
try { rateLimit = require('express-rate-limit'); } 
catch { console.warn('⚠ express-rate-limit no instalado — ejecuta npm install'); rateLimit = () => (req,res,next) => next(); }

const app = express();

// ── CORS — only allow known origins ──────────────────────────────
const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173').split(',').map(o => o.trim());
app.use(cors({
  origin: (origin, cb) => {
    // Allow non-browser requests (Postman, server-to-server) and known origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Origen no permitido por CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '2mb' }));

// ── Rate limiters ─────────────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 10,
  message: { error: 'Demasiados intentos de login. Intenta en 15 minutos.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 200,
  message: { error: 'Demasiadas peticiones. Intenta en un momento.' },
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', loginLimiter);

// ── Routes ────────────────────────────────────────────────────────
app.get('/api/health', (req, res) =>
  res.json({ ok: true, timestamp: new Date().toISOString() })
);

app.use('/api/auth',        require('./routes/auth'));
app.use('/api/equipos',     require('./routes/equipos'));
app.use('/api/componentes', require('./routes/componentes'));
app.use('/api/movimientos', require('./routes/movimientos'));
app.use('/api/repuestos',   require('./routes/repuestos'));
app.use('/api/partsurfer',  require('./routes/partsurfer'));
app.use('/api/reportes',    require('./routes/reportes'));

// ── Error handler — never leak internals in production ────────────
app.use((err, req, res, next) => {
  const isProd = process.env.NODE_ENV === 'production';
  const status = err.status || 500;

  // Always log full error server-side
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.path} → ${status}:`, err.message);

  // In production, only return generic message for 500s
  const message = (isProd && status === 500)
    ? 'Error interno del servidor'
    : (err.message || 'Error interno');

  res.status(status).json({ error: message });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`🚀 API corriendo en puerto ${PORT}`));
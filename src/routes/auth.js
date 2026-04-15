const router = require('express').Router();
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const auth   = require('../middleware/auth');
const prisma = new PrismaClient();

// Sanitize input
function sanitize(str) {
  return typeof str === 'string' ? str.trim().slice(0, 200) : '';
}

router.post('/login', async (req, res, next) => {
  try {
    const email    = sanitize(req.body.email).toLowerCase();
    const password = sanitize(req.body.password);

    if (!email || !password)
      return res.status(400).json({ error: 'Email y contraseña requeridos' });

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return res.status(400).json({ error: 'Email inválido' });

    const user = await prisma.usuario.findUnique({ where: { email } });

    // Same error for user-not-found and wrong-password (prevents user enumeration)
    if (!user || !user.activo || !(await bcrypt.compare(password, user.password_hash)))
      return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign(
      { id: user.id, email: user.email, nombre: user.nombre, rol: user.rol },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({ token, user: { id: user.id, nombre: user.nombre, email: user.email, rol: user.rol } });
  } catch (err) { next(err); }
});

// /register — requires auth + ADMIN role only
router.post('/register', auth, async (req, res, next) => {
  try {
    if (req.user.rol !== 'ADMIN')
      return res.status(403).json({ error: 'Solo administradores pueden crear usuarios' });

    const nombre   = sanitize(req.body.nombre);
    const email    = sanitize(req.body.email).toLowerCase();
    const password = sanitize(req.body.password);
    // Prevent privilege escalation — only ADMIN can create ADMINs
    const rol = req.body.rol === 'ADMIN' && req.user.rol === 'ADMIN' ? 'ADMIN' : 'TECNICO';

    if (!nombre || !email || !password)
      return res.status(400).json({ error: 'Nombre, email y contraseña requeridos' });

    if (password.length < 8)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres' });

    const user = await prisma.usuario.create({
      data: { nombre, email, password_hash: await bcrypt.hash(password, 12), rol },
      select: { id: true, nombre: true, email: true, rol: true }
    });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Ya existe un usuario con ese email' });
    next(err);
  }
});

module.exports = router;
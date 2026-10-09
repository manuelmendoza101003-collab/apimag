require('dotenv').config();
require('dns').setDefaultResultOrder('ipv4first');
const express = require('express');
const cors = require('cors');


const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/perfil', require('./routes/perfil.routes'));
app.use('/api/pacientes', require('./routes/pacientes.routes'));
app.use('/api/consultas', require('./routes/consultas.routes'));
app.use('/api/dashboard', require('./routes/dashboard.routes'));
app.use('/api/citas', require('./routes/citas.routes'));
app.use('/api/evaluaciones-ml', require('./routes/evaluaciones-ml.routes'));
app.use('/api/mensajes', require('./routes/mensajes.routes'));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Endpoint no encontrado'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    message: 'Error interno del servidor'
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
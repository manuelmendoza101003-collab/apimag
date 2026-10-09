const express = require('express');
const router  = express.Router();
const { verificarToken } = require('../middleware/auth.middleware');
const {
  listarMensajes,
  contarNoLeidos,
  obtenerMensaje,
  marcarLeido,
  responderMensaje
} = require('../controllers/mensajes.controller');

// JWT requerido en todas las rutas
router.use(verificarToken);

router.get('/',                    listarMensajes);
router.get('/no-leidos/count',     contarNoLeidos);   // va antes de '/:id'
router.get('/:id',                 obtenerMensaje);
router.patch('/:id/leido',         marcarLeido);
router.post('/:id/responder',      responderMensaje);

module.exports = router;
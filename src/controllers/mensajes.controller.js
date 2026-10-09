const pool = require('../config/database');

const TABLA_MENSAJES   = 'mensajes_paciente';
const TABLA_RESPUESTAS = 'respuestas_mensajes';

const MOTIVOS_VALIDOS = [
  'Síntomas nuevos o peores',
  'Dudas con mi medicamento',
  'Efectos secundarios',
  'Solicitar cita',
  'Otro'
];

const MAX_LARGO_RESPUESTA = 2000;

// Convierte un parámetro de ruta a entero positivo (o null si no es válido)
function parseId(valor) {
  const id = Number(valor);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * GET /api/mensajes
 * Listar mensajes recibidos por el doctor
 * Filtros opcionales: leido (true/false), respondido (true/false), paciente_id, motivo
 * Paginación: limit (máx 100), offset
 */
async function listarMensajes(req, res) {
  try {
    const doctorId = req.doctor.id;
    const { leido, respondido, paciente_id, motivo, limit = 20, offset = 0 } = req.query;

    const condiciones = ['m.doctor_id = $1'];
    const params = [doctorId];

    if (leido !== undefined) {
      if (!['true', 'false'].includes(leido)) {
        return res.status(400).json({ success: false, message: 'leido debe ser true o false' });
      }
      params.push(leido === 'true');
      condiciones.push(`m.leido = $${params.length}`);
    }

    if (respondido !== undefined) {
      if (!['true', 'false'].includes(respondido)) {
        return res.status(400).json({ success: false, message: 'respondido debe ser true o false' });
      }
      condiciones.push(
        `${respondido === 'true' ? '' : 'NOT '}EXISTS (SELECT 1 FROM ${TABLA_RESPUESTAS} r WHERE r.mensaje_id = m.id)`
      );
    }

    if (paciente_id) {
      const pid = parseId(paciente_id);
      if (!pid) {
        return res.status(400).json({ success: false, message: 'paciente_id no válido' });
      }
      params.push(pid);
      condiciones.push(`m.paciente_id = $${params.length}`);
    }

    if (motivo) {
      if (!MOTIVOS_VALIDOS.includes(motivo)) {
        return res.status(400).json({
          success: false,
          message: `Motivo no válido. Valores permitidos: ${MOTIVOS_VALIDOS.join(', ')}`
        });
      }
      params.push(motivo);
      condiciones.push(`m.motivo = $${params.length}`);
    }

    const where = condiciones.join(' AND ');
    const lim = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    const result = await pool.query(
      `SELECT
         m.id,
         m.paciente_id,
         p.nombre_completo AS paciente_nombre,
         p.correo          AS paciente_correo,
         p.telefono        AS paciente_telefono,
         m.motivo,
         m.sintomas,
         m.desde_cuando,
         m.detalles,
         m.leido,
         m.created_at,
         (SELECT COUNT(*)::INTEGER FROM ${TABLA_RESPUESTAS} r WHERE r.mensaje_id = m.id) AS total_respuestas
       FROM ${TABLA_MENSAJES} m
       JOIN pacientes p ON p.id = m.paciente_id
       WHERE ${where}
       ORDER BY m.leido ASC, m.created_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, lim, off]
    );

    const countResult = await pool.query(
      `SELECT COUNT(*)::INTEGER AS total FROM ${TABLA_MENSAJES} m WHERE ${where}`,
      params
    );
    const total = countResult.rows[0].total;

    const mensajes = result.rows.map(m => ({
      ...m,
      sintomas: m.sintomas || [],
      respondido: m.total_respuestas > 0
    }));

    res.json({
      success: true,
      data: mensajes,
      pagination: {
        total,
        limit: lim,
        offset: off,
        next_offset: off + lim < total ? off + lim : null
      }
    });

  } catch (error) {
    console.error('Error en listarMensajes:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
}

/**
 * GET /api/mensajes/no-leidos/count
 * Cantidad de mensajes sin leer (para el contador / badge)
 */
async function contarNoLeidos(req, res) {
  try {
    const result = await pool.query(
      `SELECT COUNT(*)::INTEGER AS total
       FROM ${TABLA_MENSAJES}
       WHERE doctor_id = $1 AND leido = FALSE`,
      [req.doctor.id]
    );

    res.json({ success: true, data: { no_leidos: result.rows[0].total } });

  } catch (error) {
    console.error('Error en contarNoLeidos:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
}

/**
 * GET /api/mensajes/:id
 * Detalle del mensaje + sus respuestas.
 * Al abrirlo se marca automáticamente como leído.
 */
async function obtenerMensaje(req, res) {
  try {
    const doctorId = req.doctor.id;
    const mensajeId = parseId(req.params.id);

    if (!mensajeId) {
      return res.status(400).json({ success: false, message: 'ID de mensaje no válido' });
    }

    const result = await pool.query(
      `SELECT
         m.id,
         m.paciente_id,
         p.nombre_completo AS paciente_nombre,
         p.correo          AS paciente_correo,
         p.telefono        AS paciente_telefono,
         p.fecha_nacimiento,
         m.motivo,
         m.sintomas,
         m.desde_cuando,
         m.detalles,
         m.leido,
         m.created_at
       FROM ${TABLA_MENSAJES} m
       JOIN pacientes p ON p.id = m.paciente_id
       WHERE m.id = $1 AND m.doctor_id = $2`,
      [mensajeId, doctorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Mensaje no encontrado o no pertenece a tu cuenta'
      });
    }

    const mensaje = result.rows[0];
    mensaje.sintomas = mensaje.sintomas || [];

    // Marcar como leído al abrirlo
    if (!mensaje.leido) {
      await pool.query(
        `UPDATE ${TABLA_MENSAJES} SET leido = TRUE WHERE id = $1 AND doctor_id = $2`,
        [mensajeId, doctorId]
      );
      mensaje.leido = true;
    }

    const respuestas = await pool.query(
      `SELECT id, doctor_id, texto, leido_paciente, created_at
       FROM ${TABLA_RESPUESTAS}
       WHERE mensaje_id = $1
       ORDER BY created_at ASC`,
      [mensajeId]
    );

    mensaje.respuestas = respuestas.rows;

    res.json({ success: true, data: mensaje });

  } catch (error) {
    console.error('Error en obtenerMensaje:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
}

/**
 * PATCH /api/mensajes/:id/leido
 * Marcar como leído o no leído. Body: { "leido": true | false } (por defecto true)
 */
async function marcarLeido(req, res) {
  try {
    const doctorId = req.doctor.id;
    const mensajeId = parseId(req.params.id);
    const { leido = true } = req.body || {};

    if (!mensajeId) {
      return res.status(400).json({ success: false, message: 'ID de mensaje no válido' });
    }

    if (typeof leido !== 'boolean') {
      return res.status(400).json({ success: false, message: 'leido debe ser true o false' });
    }

    const result = await pool.query(
      `UPDATE ${TABLA_MENSAJES}
       SET leido = $1
       WHERE id = $2 AND doctor_id = $3
       RETURNING id, leido`,
      [leido, mensajeId, doctorId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Mensaje no encontrado o no pertenece a tu cuenta'
      });
    }

    res.json({
      success: true,
      message: leido ? 'Mensaje marcado como leído' : 'Mensaje marcado como no leído',
      data: result.rows[0]
    });

  } catch (error) {
    console.error('Error en marcarLeido:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
}

/**
 * POST /api/mensajes/:id/responder
 * El doctor responde al paciente. Body: { "texto": "..." }
 */
async function responderMensaje(req, res) {
  const client = await pool.connect();

  try {
    const doctorId = req.doctor.id;
    const mensajeId = parseId(req.params.id);
    const texto = typeof req.body?.texto === 'string' ? req.body.texto.trim() : '';

    if (!mensajeId) {
      return res.status(400).json({ success: false, message: 'ID de mensaje no válido' });
    }

    if (!texto) {
      return res.status(400).json({ success: false, message: 'El texto de la respuesta es requerido' });
    }

    if (texto.length > MAX_LARGO_RESPUESTA) {
      return res.status(400).json({
        success: false,
        message: `La respuesta no puede superar ${MAX_LARGO_RESPUESTA} caracteres`
      });
    }

    const mensaje = await client.query(
      `SELECT id FROM ${TABLA_MENSAJES} WHERE id = $1 AND doctor_id = $2`,
      [mensajeId, doctorId]
    );

    if (mensaje.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Mensaje no encontrado o no pertenece a tu cuenta'
      });
    }

    await client.query('BEGIN');

    const result = await client.query(
      `INSERT INTO ${TABLA_RESPUESTAS} (mensaje_id, doctor_id, texto)
       VALUES ($1, $2, $3)
       RETURNING id, mensaje_id, texto, leido_paciente, created_at`,
      [mensajeId, doctorId, texto]
    );

    // Si respondió, ya lo leyó
    await client.query(
      `UPDATE ${TABLA_MENSAJES} SET leido = TRUE WHERE id = $1`,
      [mensajeId]
    );

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Respuesta enviada correctamente',
      data: result.rows[0]
    });

  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Error en responderMensaje:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  } finally {
    client.release();
  }
}

module.exports = {
  listarMensajes,
  contarNoLeidos,
  obtenerMensaje,
  marcarLeido,
  responderMensaje
};
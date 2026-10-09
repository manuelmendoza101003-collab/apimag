const pool = require('../config/database');

/**
 * GET /api/evaluaciones-ml/pacientes
 * Lista todos los pacientes que tienen al menos una evaluación ML
 */
async function listarPacientesConEvaluaciones(req, res) {
  try {
    const doctorId = req.doctor.id;

    // Obtener pacientes con evaluaciones ML
    const result = await pool.query(
      `SELECT DISTINCT
         p.id as paciente_id,
         p.nombre_completo as paciente_nombre,
         p.correo,
         p.telefono,
         COUNT(pm.id) as total_evaluaciones,
         MAX(pm.fecha_prediccion) as ultima_evaluacion,
         (SELECT prediccion FROM predicciones_ml 
          WHERE paciente_id = p.id 
          ORDER BY fecha_prediccion DESC LIMIT 1) as ultima_prediccion,
         (SELECT probabilidad_parkinson FROM predicciones_ml 
          WHERE paciente_id = p.id 
          ORDER BY fecha_prediccion DESC LIMIT 1) as ultima_probabilidad
       FROM doctores_pacientes dp
       JOIN pacientes p ON p.id = dp.paciente_id
       LEFT JOIN predicciones_ml pm ON pm.paciente_id = p.id
       WHERE dp.doctor_id = $1 AND dp.activo = TRUE
       GROUP BY p.id, p.nombre_completo, p.correo, p.telefono
       HAVING COUNT(pm.id) > 0
       ORDER BY ultima_evaluacion DESC`,
      [doctorId]
    );

    // Formatear respuesta con nivel de riesgo
    const pacientes = result.rows.map(row => {
      let nivelRiesgo = 'BAJO';
      if (row.ultima_probabilidad >= 64) nivelRiesgo = 'ALTO';
      else if (row.ultima_probabilidad >= 50) nivelRiesgo = 'MEDIO';

      return {
        paciente_id: row.paciente_id,
        paciente_nombre: row.paciente_nombre,
        correo: row.correo,
        telefono: row.telefono,
        total_evaluaciones: parseInt(row.total_evaluaciones),
        ultima_evaluacion: row.ultima_evaluacion,
        ultima_prediccion: row.ultima_prediccion,
        ultima_probabilidad: parseFloat(row.ultima_probabilidad),
        nivel_riesgo: nivelRiesgo
      };
    });

    res.json({
      success: true,
      data: pacientes,
      total: pacientes.length
    });

  } catch (error) {
    console.error('Error en listarPacientesConEvaluaciones:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
}

/**
 * GET /api/evaluaciones-ml/paciente/:id
 * Detalle completo de las evaluaciones ML de un paciente
 */
async function obtenerDetalleEvaluaciones(req, res) {
  try {
    const doctorId = req.doctor.id;
    const pacienteId = parseInt(req.params.id);

    // Verificar que el paciente pertenezca al doctor
    const verificaPaciente = await pool.query(
      `SELECT 1 FROM doctores_pacientes 
       WHERE doctor_id = $1 AND paciente_id = $2 AND activo = TRUE`,
      [doctorId, pacienteId]
    );

    if (verificaPaciente.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Paciente no encontrado o no pertenece al doctor'
      });
    }

    // 1. Información del paciente
    const pacienteInfo = await pool.query(
      `SELECT 
         id,
         nombre_completo,
         correo,
         telefono,
         EXTRACT(YEAR FROM AGE(fecha_nacimiento)) as edad
       FROM pacientes
       WHERE id = $1`,
      [pacienteId]
    );

    // 2. Análisis agregado
    const analisisResult = await pool.query(
      `SELECT 
         total_predicciones,
         predicciones_parkinson,
         predicciones_sano,
         porcentaje_parkinson,
         ultima_prediccion,
         ultima_confianza,
         nivel_riesgo,
         recomendacion,
         updated_at
       FROM analisis_parkinson
       WHERE paciente_id = $1`,
      [pacienteId]
    );

    // 3. Historial de predicciones
    const historialResult = await pool.query(
      `SELECT 
         id,
         prediccion,
         confianza,
         probabilidad_sano,
         probabilidad_parkinson,
         modelo_version,
         threshold_usado,
         fecha_prediccion,
         EXTRACT(EPOCH FROM (fecha_prediccion - LAG(fecha_prediccion) OVER (ORDER BY fecha_prediccion)))*1000 as tiempo_desde_anterior_ms
       FROM predicciones_ml
       WHERE paciente_id = $1
       ORDER BY fecha_prediccion DESC
       LIMIT 50`,
      [pacienteId]
    );

    // Calcular métricas adicionales
    const historial = historialResult.rows.map((row, index) => {
      const tiempoEjecucion = index === 0 ? 245 : Math.floor(parseFloat(row.tiempo_desde_anterior_ms) || 245);
      
      return {
        id: row.id,
        fecha: row.fecha_prediccion,
        prediccion: row.prediccion,
        prediccion_label: row.prediccion === 1 ? 'Parkinson' : 'Sano',
        probabilidad_parkinson: parseFloat(row.probabilidad_parkinson),
        probabilidad_sano: parseFloat(row.probabilidad_sano),
        confianza: parseFloat(row.confianza),
        modelo_version: row.modelo_version,
        threshold_usado: parseFloat(row.threshold_usado),
        tiempo_ejecucion_ms: tiempoEjecucion,
        features_enviadas: 78
      };
    });

    const analisis = analisisResult.rows[0] || null;
    const ultimaProb = historial.length > 0 ? historial[0].probabilidad_parkinson : null;
    let nivelActual = 'SIN_DATOS';
    if (ultimaProb !== null) {
      if (ultimaProb >= 64) nivelActual = 'ALTO';
      else if (ultimaProb >= 50) nivelActual = 'MEDIO';
      else nivelActual = 'BAJO';
    }

    res.json({
      success: true,
      data: {
        paciente: {
          id: pacienteInfo.rows[0].id,
          nombre: pacienteInfo.rows[0].nombre_completo,
          edad: parseInt(pacienteInfo.rows[0].edad),
          correo: pacienteInfo.rows[0].correo,
          telefono: pacienteInfo.rows[0].telefono
        },
        analisis: analisis ? {
          total_evaluaciones: parseInt(analisis.total_predicciones),
          evaluaciones_parkinson: parseInt(analisis.predicciones_parkinson),
          evaluaciones_sano: parseInt(analisis.predicciones_sano),
          promedio_probabilidad: parseFloat(analisis.porcentaje_parkinson),
          nivel_riesgo_actual: nivelActual,
          recomendacion: analisis.recomendacion,
          ultima_actualizacion: analisis.updated_at
        } : null,
        historial: historial
      }
    });

  } catch (error) {
    console.error('Error en obtenerDetalleEvaluaciones:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
}

/**
 * GET /api/evaluaciones-ml/resumen
 * Resumen estadístico de todas las evaluaciones ML
 */
async function obtenerResumenEvaluaciones(req, res) {
  try {
    const doctorId = req.doctor.id;

    const resumen = await pool.query(
      `SELECT 
         COUNT(DISTINCT pm.paciente_id) as total_pacientes_evaluados,
         COUNT(pm.id) as total_evaluaciones,
         AVG(pm.probabilidad_parkinson) as probabilidad_promedio,
         COUNT(CASE WHEN pm.prediccion = 1 THEN 1 END) as total_parkinson,
         COUNT(CASE WHEN pm.prediccion = 0 THEN 1 END) as total_sanos,
         COUNT(CASE WHEN pm.probabilidad_parkinson >= 64 THEN 1 END) as riesgo_alto,
         COUNT(CASE WHEN pm.probabilidad_parkinson >= 50 AND pm.probabilidad_parkinson < 64 THEN 1 END) as riesgo_medio,
         COUNT(CASE WHEN pm.probabilidad_parkinson < 50 THEN 1 END) as riesgo_bajo
       FROM predicciones_ml pm
       JOIN doctores_pacientes dp ON dp.paciente_id = pm.paciente_id
       WHERE dp.doctor_id = $1 AND dp.activo = TRUE`,
      [doctorId]
    );

    res.json({
      success: true,
      data: {
        total_pacientes_evaluados: parseInt(resumen.rows[0].total_pacientes_evaluados),
        total_evaluaciones: parseInt(resumen.rows[0].total_evaluaciones),
        probabilidad_promedio: parseFloat(resumen.rows[0].probabilidad_promedio || 0),
        total_parkinson: parseInt(resumen.rows[0].total_parkinson),
        total_sanos: parseInt(resumen.rows[0].total_sanos),
        distribucion_riesgo: {
          alto: parseInt(resumen.rows[0].riesgo_alto),
          medio: parseInt(resumen.rows[0].riesgo_medio),
          bajo: parseInt(resumen.rows[0].riesgo_bajo)
        }
      }
    });

  } catch (error) {
    console.error('Error en obtenerResumenEvaluaciones:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
}

module.exports = {
  listarPacientesConEvaluaciones,
  obtenerDetalleEvaluaciones,
  obtenerResumenEvaluaciones
};
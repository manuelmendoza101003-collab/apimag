const nodemailer = require('nodemailer');

/**
 * ENVÍO DE CORREOS
 *
 * - Si existe EMAIL_RELAY_URL (Railway): se envía por HTTPS a través de un
 *   Google Apps Script que manda el correo desde la cuenta de Gmail.
 *   Railway bloquea SMTP en el plan gratuito, pero HTTPS sí funciona.
 * - Si NO existe (local): se usa Gmail por SMTP, igual que antes.
 */
const RELAY_URL    = (process.env.EMAIL_RELAY_URL || '').trim();
const RELAY_SECRET = (process.env.EMAIL_RELAY_SECRET || '').trim();
const USAR_RELAY   = RELAY_URL !== '';

let transporter = null;

if (USAR_RELAY) {
  console.log('✅ Correo configurado vía Google Apps Script (HTTPS)');
} else {
  transporter = nodemailer.createTransport({
    host: process.env.EMAIL_HOST, // smtp.gmail.com
    port: parseInt(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
    tls: {
      rejectUnauthorized: false
    }
  });

  transporter.verify((error) => {
    if (error) {
      console.error('❌ Error configurando Gmail:', error);
    } else {
      console.log('✅ Servidor de correo Gmail listo');
    }
  });
}

/**
 * Envía un correo por el medio que esté configurado.
 * Devuelve un objeto con messageId para mantener el mismo formato de antes.
 */
async function enviarCorreo({ to, subject, html, text }) {
  if (!USAR_RELAY) {
    return transporter.sendMail({ from: process.env.EMAIL_FROM, to, subject, html, text });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const respuesta = await fetch(RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: RELAY_SECRET,
        to,
        subject,
        html,
        text: text || '',
        fromName: 'NeuroTrack'
      }),
      redirect: 'follow',
      signal: controller.signal
    });

    const contenido = await respuesta.text();
    let datos;
    try {
      datos = JSON.parse(contenido);
    } catch {
      throw new Error(`Respuesta inesperada del servicio de correo (HTTP ${respuesta.status})`);
    }

    if (!datos.ok) {
      throw new Error(`Servicio de correo: ${datos.error || 'error desconocido'}`);
    }

    return { messageId: `apps-script-${Date.now()}`, restantesHoy: datos.remaining };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Envía email con código de verificación
 */
async function enviarCodigoVerificacion(correo, codigo) {
  try {
    const info = await enviarCorreo({
      to: correo,
      subject: 'Tu código de verificación - NeuroTrack',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #2c7a6b; margin: 0;">NeuroTrack</h2>
          </div>
          
          <h3 style="color: #333;">Verifica tu correo electrónico</h3>
          <p style="color: #666; font-size: 16px;">
            Gracias por registrarte en NeuroTrack. Para completar tu registro, 
            ingresa el siguiente código de verificación:
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <span style="display: inline-block; padding: 15px 30px; background-color: #f0f9f8; 
                         border: 2px solid #2c7a6b; border-radius: 8px; font-size: 32px; 
                         font-weight: bold; letter-spacing: 8px; color: #2c7a6b;">
              ${codigo}
            </span>
          </div>
          
          <p style="color: #666; font-size: 14px;">
             Este código expira en <strong>15 minutos</strong>.<br>
             Si no solicitaste este código, ignora este mensaje.
          </p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="color: #999; font-size: 12px; text-align: center;">
            NeuroTrack - Plataforma de monitoreo para pacientes con Parkinson<br>
            © 2024 Todos los derechos reservados
          </p>
        </div>
      `,
      text: `Tu código de verificación es: ${codigo}. Expira en 15 minutos.`
    });

    console.log('✅ Email de verificación enviado:', info.messageId);
    return info;
  } catch (error) {
    console.error('❌ Error enviando email:', error.message);
    throw error;
  }
}

/**
 * Envía email de cuenta activada
 */
async function enviarEmailActivacion(correo) {
  try {
    const info = await enviarCorreo({
      to: correo,
      subject: 'Tu cuenta NeuroTrack ha sido activada',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <div style="text-align: center; margin-bottom: 30px;">
            <h2 style="color: #2c7a6b; margin: 0;">NeuroTrack</h2>
          </div>
          
          <h3 style="color: #333;">¡Cuenta Activada! </h3>
          <p style="color: #666; font-size: 16px;">
            Tu cuenta ha sido verificada exitosamente por nuestro equipo.
          </p>
          
          <p style="color: #666; font-size: 16px;">
            Ahora puedes iniciar sesión en NeuroTrack y comenzar a gestionar 
            a tus pacientes con Parkinson.
          </p>
          
          <div style="text-align: center; margin: 30px 0;">
            <a href="${(process.env.FRONTEND_URL || '').trim()}/login" 
               style="display: inline-block; padding: 15px 30px; background-color: #2c7a6b; 
                      color: white; text-decoration: none; border-radius: 8px; font-weight: bold;">
              Iniciar Sesión
            </a>
          </div>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
          
          <p style="color: #999; font-size: 12px; text-align: center;">
            NeuroTrack - Plataforma de monitoreo para pacientes con Parkinson<br>
            © 2024 Todos los derechos reservados
          </p>
        </div>
      `,
      text: 'Tu cuenta NeuroTrack ha sido activada. Ya puedes iniciar sesión.'
    });

    console.log('✅ Email de activación enviado:', info.messageId);
    return info;
  } catch (error) {
    console.error('❌ Error enviando email:', error.message);
    throw error;
  }
}

module.exports = { enviarCodigoVerificacion, enviarEmailActivacion };
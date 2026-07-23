const nodemailer = require('nodemailer');

function buildTransport() {
  if (!process.env.SMTP_HOST) return null;
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true',
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  });
}

async function notifyHotLead(lead) {
  const subject = `🔥 Hot commercial lead: ${lead.company_name} (score ${lead.score})`;
  const body = [
    `Company: ${lead.company_name}`,
    `Contact: ${lead.contact_name} <${lead.email}> ${lead.phone || ''}`,
    `Role: ${lead.role || 'n/a'}`,
    `Facility: ${lead.facility_type || 'n/a'} in ${lead.city || ''}, ${lead.state || ''}`,
    `Monthly bill: $${lead.monthly_bill_usd || 0}`,
    `Roof/land: ${lead.roof_land_sqft || 0} sqft`,
    `Interest: ${lead.interest || 'n/a'}`,
    `Timeline: ${lead.timeline || 'n/a'}`,
    `Score: ${lead.score} (${lead.grade})`,
  ].join('\n');

  const transport = buildTransport();
  if (!transport) {
    console.log(`[mailer] SMTP not configured, would send:\n${subject}\n${body}`);
    return { sent: false, reason: 'smtp-not-configured' };
  }

  await transport.sendMail({
    from: process.env.NOTIFY_FROM || 'leads@example.com',
    to: process.env.NOTIFY_TO || 'sales@example.com',
    subject,
    text: body,
  });
  return { sent: true };
}

module.exports = { notifyHotLead };

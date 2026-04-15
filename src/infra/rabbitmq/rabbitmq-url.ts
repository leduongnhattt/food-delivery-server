/**
 * Builds AMQP connection URL from env. Prefer explicit RABBITMQ_URL when set.
 */
export function buildRabbitMqConnectionUrl(): string | null {
  const direct = process.env.RABBITMQ_URL?.trim();
  if (direct) {
    return direct;
  }
  const host = process.env.RABBITMQ_HOST?.trim();
  const port = process.env.RABBITMQ_PORT?.trim() || '5672';
  const user = process.env.RABBITMQ_USER?.trim();
  const pass = process.env.RABBITMQ_PASSWORD?.trim();
  if (!host || user === undefined || pass === undefined) {
    return null;
  }
  const vhostRaw = process.env.RABBITMQ_VHOST?.trim() ?? '/';
  const vhostEnc = encodeURIComponent(vhostRaw);
  const u = encodeURIComponent(user);
  const p = encodeURIComponent(pass);
  return `amqp://${u}:${p}@${host}:${port}/${vhostEnc}`;
}

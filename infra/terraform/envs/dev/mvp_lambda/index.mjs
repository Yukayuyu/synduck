import AWS from 'aws-sdk';

const ddb = new AWS.DynamoDB.DocumentClient();

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

export const handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod;
  const path = event?.rawPath || event?.path || '/';

  if (method === 'OPTIONS') return json(200, { ok: true });

  if (path === '/health') {
    return json(200, { ok: true, service: 'synduck', env: process.env.ENV || 'dev' });
  }

  const table = process.env.SESSIONS_TABLE;
  if (!table) return json(500, { ok: false, error: 'missing_table' });

  if (method === 'GET' && path === '/nodes') {
    const res = await ddb
      .scan({
        TableName: table,
        Limit: 50,
      })
      .promise();

    const items = (res.Items || []).map((it) => ({
      id: it.pk,
      label: it.label,
      note: it.note,
      createdAt: it.createdAt,
    }));

    return json(200, { ok: true, items });
  }

  if (method === 'POST' && path === '/nodes') {
    let payload;
    try {
      payload = JSON.parse(event?.body || '{}');
    } catch {
      return json(400, { ok: false, error: 'invalid_json' });
    }

    const label = String(payload?.label || '').trim();
    const note = String(payload?.note || '').trim();
    if (!label) return json(400, { ok: false, error: 'missing_label' });

    const id = `node#${Date.now()}#${Math.random().toString(16).slice(2)}`;
    const createdAt = new Date().toISOString();

    await ddb
      .put({
        TableName: table,
        Item: {
          pk: id,
          label,
          note,
          createdAt,
        },
      })
      .promise();

    return json(201, { ok: true, id });
  }

  return json(404, { ok: false, error: 'not_found' });
};

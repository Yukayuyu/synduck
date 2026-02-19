const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      // CORS
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function isNodePk(pk) {
  return typeof pk === 'string' && pk.startsWith('node#');
}

function isEdgePk(pk) {
  return typeof pk === 'string' && pk.startsWith('edge#');
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod;
  const path = event?.rawPath || event?.path || '/';

  if (method === 'OPTIONS') return json(200, { ok: true });

  if (path === '/health') {
    return json(200, { ok: true, service: 'synduck', env: process.env.ENV || 'dev' });
  }

  const table = process.env.SESSIONS_TABLE;
  if (!table) return json(500, { ok: false, error: 'missing_table' });

  if (method === 'GET' && path === '/nodes') {
    const res = await ddb.send(
      new ScanCommand({
        TableName: table,
        Limit: 200,
      }),
    );

    const items = (res.Items || [])
      .filter((it) => isNodePk(it.pk))
      .map((it) => ({
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

    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: { pk: id, label, note, createdAt },
      }),
    );

    return json(201, { ok: true, id });
  }

  if (method === 'GET' && path === '/edges') {
    const res = await ddb.send(
      new ScanCommand({
        TableName: table,
        Limit: 500,
      }),
    );

    const items = (res.Items || [])
      .filter((it) => isEdgePk(it.pk))
      .map((it) => ({
        id: it.pk,
        from: it.from,
        to: it.to,
        note: it.note,
        createdAt: it.createdAt,
      }));

    return json(200, { ok: true, items });
  }

  if (method === 'POST' && path === '/edges') {
    let payload;
    try {
      payload = JSON.parse(event?.body || '{}');
    } catch {
      return json(400, { ok: false, error: 'invalid_json' });
    }

    const from = String(payload?.from || '').trim();
    const to = String(payload?.to || '').trim();
    const note = String(payload?.note || '').trim();

    if (!from || !to) return json(400, { ok: false, error: 'missing_endpoints' });
    if (from === to) return json(400, { ok: false, error: 'self_edge_not_allowed' });

    const id = `edge#${Date.now()}#${Math.random().toString(16).slice(2)}`;
    const createdAt = new Date().toISOString();

    await ddb.send(
      new PutCommand({
        TableName: table,
        Item: { pk: id, from, to, note, createdAt },
      }),
    );

    return json(201, { ok: true, id });
  }


  if (method === 'DELETE' && path === '/edges') {
    const qs = event?.queryStringParameters || {};
    const from = String(qs.from || '').trim();
    const to = String(qs.to || '').trim();
    if (!from || !to) return json(400, { ok: false, error: 'missing_endpoints' });

    // MVP: scan to find matching edge (either direction).
    const res = await ddb.send(
      new ScanCommand({
        TableName: table,
        Limit: 500,
      }),
    );

    const items = res.Items || [];
    const match = items.find((it) =>
      isEdgePk(it.pk) &&
      ((it.from === from && it.to === to) || (it.from === to && it.to === from)),
    );

    if (!match) return json(404, { ok: false, error: 'edge_not_found' });

    await ddb.send(
      new DeleteCommand({
        TableName: table,
        Key: { pk: match.pk },
      }),
    );

    return json(200, { ok: true, id: match.pk });
  }

  return json(404, { ok: false, error: 'not_found' });
};

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function json400(msg) { return json(400, {ok: false, error: msg}); }
function json401(msg) { return json(401, {ok: false, error: msg}); }
function json403(msg) { return json(403, {ok: false, error: msg}); }
function json404(msg) { return json(404, {ok: false, error: msg}); }

function getSub(event) {
  return event.requestContext?.authorizer?.jwt?.claims?.sub || null;
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod;
  const path = event?.rawPath || event?.path || '/';
  const qs = event.queryStringParameters || {};
  const sub = getSub(event);

  if (method === 'OPTIONS') return json(200, { ok: true });

  if (path === '/health') {
    return json(200, { ok: true, service: 'synduck', env: process.env.ENV || 'dev' });
  }

  const table = process.env.SESSIONS_TABLE;
  if (!table) return json(500, { ok: false, error: 'missing_table' });

  // graphs
  if (path === '/graphs') {
    if (method === 'GET') {
      const res = await ddb.send(new ScanCommand({ TableName: table, Limit: 100 }));
      let items = (res.Items || [])
        .filter((it) => it.pk.startsWith('graph#'))
        .map((it) => ({
          id: it.pk.slice(6),
          name: it.name,
          visibility: it.visibility,
          owner: it.owner,
          createdAt: it.createdAt,
        })).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

      const type = qs.type || (sub ? 'my' : 'public');
      if (type === 'public') {
        items = items.filter((it) => it.visibility === 'public');
      } else if (type === 'my') {
        if (!sub) return json401('unauthorized');
        items = items.filter((it) => it.owner === sub);
      }
      return json(200, { ok: true, items });
    }

    if (method === 'POST') {
      if (!sub) return json401('unauthorized');
      let payload;
      try { payload = JSON.parse(event.body || '{}'); } catch { return json400('invalid_json'); }
      const name = String(payload.name || '').trim();
      if (!name) return json400('missing_name');
      const graphId = `g${Date.now()}#${Math.random().toString(16).slice(2, 8)}`;
      const pk = `graph#${graphId}`;
      const createdAt = new Date().toISOString();
      const visibility = payload.visibility === 'public' ? 'public' : 'private';
      await ddb.send(new PutCommand({
        TableName: table,
        Item: { pk, name, visibility, owner: sub, createdAt },
      }));
      return json(201, { ok: true, id: graphId });
    }

    if (method === 'DELETE') {
      if (!sub) return json401('unauthorized');
      const graphId = String(qs.id || '').trim();
      if (!graphId) return json400('missing_id');
      const pk = `graph#${graphId}`;
      const gres = await ddb.send(new GetCommand({ TableName: table, Key: { pk } }));
      if (!gres.Item) return json404('not_found');
      if (gres.Item.owner !== sub) return json403('not_owner');
      await ddb.send(new DeleteCommand({ TableName: table, Key: { pk } }));
      // cascade delete nodes
      const nres = await ddb.send(new ScanCommand({ TableName: table, Limit: 1000 }));
      for (const it of nres.Items || []) {
        if (it.pk.startsWith(`node#${graphId}#`)) {
          await ddb.send(new DeleteCommand({ TableName: table, Key: { pk: it.pk } }));
        }
      }
      // cascade delete edges
      const eres = await ddb.send(new ScanCommand({ TableName: table, Limit: 1000 }));
      for (const it of eres.Items || []) {
        if (it.pk.startsWith(`edge#${graphId}#`)) {
          await ddb.send(new DeleteCommand({ TableName: table, Key: { pk: it.pk } }));
        }
      }
      return json(200, { ok: true });
    }
  }

  // nodes
  const graphId = String(qs.graphId || '').trim();
  if (!graphId) return json400('missing_graphId');

  if (path === '/nodes') {
    const prefix = `node#${graphId}#`;
    if (method === 'GET') {
      const res = await ddb.send(new ScanCommand({ TableName: table, Limit: 200 }));
      const items = (res.Items || [])
        .filter((it) => it.pk.startsWith(prefix))
        .map((it) => ({
          id: it.pk.slice(prefix.length),
          label: it.label,
          note: it.note,
          createdAt: it.createdAt,
        }));
      return json(200, { ok: true, items });
    }
    if (method === 'POST') {
      if (!sub) return json401('unauthorized');
      const gpk = `graph#${graphId}`;
      const gres = await ddb.send(new GetCommand({ TableName: table, Key: { pk: gpk } }));
      if (!gres.Item || gres.Item.owner !== sub) return json403('not_owner');
      let payload;
      try { payload = JSON.parse(event.body || '{}'); } catch { return json400('invalid_json'); }
      const label = String(payload.label || '').trim();
      const note = String(payload.note || '').trim();
      if (!label) return json400('missing_label');
      const nodeLocalId = `n${Date.now()}#${Math.random().toString(16).slice(2, 8)}`;
      const pk = `${prefix}${nodeLocalId}`;
      const createdAt = new Date().toISOString();
      await ddb.send(new PutCommand({
        TableName: table,
        Item: { pk, graphId, label, note, createdAt },
      }));
      return json(201, { ok: true, id: nodeLocalId });
    }
  }

  // edges
  if (path === '/edges') {
    const prefix = `edge#${graphId}#`;
    if (method === 'GET') {
      const res = await ddb.send(new ScanCommand({ TableName: table, Limit: 500 }));
      const items = (res.Items || [])
        .filter((it) => it.pk.startsWith(prefix))
        .map((it) => ({
          id: it.pk.slice(prefix.length),
          from: it.from,
          to: it.to,
          note: it.note,
          createdAt: it.createdAt,
        }));
      return json(200, { ok: true, items });
    }
    if (method === 'POST') {
      if (!sub) return json401('unauthorized');
      const gpk = `graph#${graphId}`;
      const gres = await ddb.send(new GetCommand({ TableName: table, Key: { pk: gpk } }));
      if (!gres.Item || gres.Item.owner !== sub) return json403('not_owner');
      let payload;
      try { payload = JSON.parse(event.body || '{}'); } catch { return json400('invalid_json'); }
      const from = String(payload.from || '').trim();
      const to = String(payload.to || '').trim();
      const note = String(payload.note || '').trim();
      if (!from || !to || from === to) return json400('invalid_endpoints');
      const edgeLocalId = `e${Date.now()}#${Math.random().toString(16).slice(2, 8)}`;
      const pk = `${prefix}${edgeLocalId}`;
      const createdAt = new Date().toISOString();
      await ddb.send(new PutCommand({
        TableName: table,
        Item: { pk, graphId, from, to, note, createdAt },
      }));
      return json(201, { ok: true, id: edgeLocalId });
    }
    if (method === 'DELETE') {
      if (!sub) return json401('unauthorized');
      const from = String(qs.from || '').trim();
      const to = String(qs.to || '').trim();
      if (!from || !to) return json400('missing_endpoints');
      const gpk = `graph#${graphId}`;
      const gres = await ddb.send(new GetCommand({ TableName: table, Key: { pk: gpk } }));
      if (!gres.Item || gres.Item.owner !== sub) return json403('not_owner');
      const res = await ddb.send(new ScanCommand({ TableName: table, Limit: 500 }));
      const match = (res.Items || []).find((it) =>
        it.pk.startsWith(prefix) &&
        ((it.from === from && it.to === to) || (it.from === to && it.to === from))
      );
      if (!match) return json404('edge_not_found');
      await ddb.send(new DeleteCommand({ TableName: table, Key: { pk: match.pk } }));
      return json(200, { ok: true, id: match.pk.slice(prefix.length) });
    }
  }

  return json(404, { ok: false, error: 'not_found' });
};
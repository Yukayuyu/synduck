const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, ScanCommand, DeleteCommand, GetCommand } = require('@aws-sdk/lib-dynamodb');

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const EDGE_TYPES = new Set(['depends_on', 'references', 'related_to', 'causes']);
const ROLES = new Set(['owner', 'editor', 'viewer']);

function generateId(prefix = '') {
  return `${prefix}${Date.now()}#${Math.random().toString(16).slice(2, 8)}`;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type,authorization,x-guest-token,x-device-token',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    },
    body: JSON.stringify(body),
  };
}

function json400(msg) { return json(400, {ok: false, error: msg}); }
function json401(msg) { return json(401, {ok: false, error: msg}); }
function json403(msg) { return json(403, {ok: false, error: msg}); }
function json404(msg) { return json(404, {ok: false, error: msg}); }
function json500(msg) { return json(500, {ok: false, error: msg}); }

function getSub(event) {
  return event.requestContext?.authorizer?.jwt?.claims?.sub || null;
}

function getUserRole(event, graph) {
  const guestTokenStr = getGuestToken(event);
  if (graph.owner && graph.owner.startsWith('guest:')) {
    const guestId = graph.owner.slice(6);
    const tokenParts = guestTokenStr.split('#');
    if (tokenParts.length > 1 && tokenParts[1] === guestId) {
      return 'owner';
    }
    return null;
  }
  const sub = getSub(event);
  const qs = event.queryStringParameters || {};
  const shareToken = String(qs.shareToken || '');
  if (graph.visibility === 'public') {
    return 'viewer';
  }
  if (shareToken && graph.shareToken === shareToken) {
    return 'viewer';
  }
  if (!sub) {
    return null;
  }
  return graph.permissions?.[sub] || null;
}

function canRead(role) {
  return role != null;
}

function canWrite(role) {
  return role === 'owner' || role === 'editor';
}

function isOwnerRole(role) {
  return role === 'owner';
}

// Guest support
const GUEST_EXPIRE_MS = 60 * 60 * 1000; // 1 hour

function getGuestToken(event) {
  let token = event.headers?.['x-guest-token'] || event.headers?.['X-Guest-Token'];
  if (token) return String(token).trim();
  token = event.queryStringParameters?.guestToken;
  if (token) return String(token).trim();
  return '';
}

function getGuestId(token) {
  const parts = token.split('#');
  return parts.length > 1 ? `guest:${parts[1]}` : '';
}

// Similarity helpers
async function getGraph(table, graphId) {
  const pk = `graph#${graphId}`;
  const res = await ddb.send(new GetCommand({ TableName: table, Key: { pk } }));
  return res.Item;
}

async function scanNodes(table, graphId) {
  const prefix = `node#${graphId}#`;
  const res = await ddb.send(new ScanCommand({ TableName: table, Limit: 200 }));
  return (res.Items || []).filter((it) => it.pk.startsWith(prefix)).map((it) => ({
    id: it.pk.slice(prefix.length),
    label: it.label,
    note: it.note || '',
  }));
}

async function scanEdges(table, graphId) {
  const prefix = `edge#${graphId}#`;
  const res = await ddb.send(new ScanCommand({ TableName: table, Limit: 500 }));
  return (res.Items || []).filter((it) => it.pk.startsWith(prefix)).map((it) => ({
    id: it.pk.slice(prefix.length),
    from: it.from,
    to: it.to,
    type: it.type || 'references',
    annotation: it.annotation || '',
    note: it.note || '',
  }));
}

async function scanPublicGraphs(table) {
  const res = await ddb.send(new ScanCommand({ TableName: table, Limit: 100 }));
  return (res.Items || []).filter((it) => it.pk.startsWith('graph#') && it.visibility === 'public');
}

function computeSignature(nodes, edges) {
  const nodeLabels = new Set(nodes.map((n) => n.label));
  const edgeTypes = new Set(edges.map((e) => e.type));
  return {
    nodeLabels,
    edgeTypes,
    numNodes: nodes.length,
    numEdges: edges.length,
  };
}

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1.0;
  let inter = 0;
  for (const el of setA) {
    if (setB.has(el)) inter++;
  }
  const union = setA.size + setB.size - inter;
  return union === 0 ? 0 : inter / union;
}

function similarityScore(sig1, sig2) {
  const labelSim = jaccard(sig1.nodeLabels, sig2.nodeLabels);
  const typeSim = jaccard(sig1.edgeTypes, sig2.edgeTypes);
  const nodeSizeSim = 1 - Math.abs(sig1.numNodes - sig2.numNodes) / Math.max(sig1.numNodes, sig2.numNodes, 1);
  const edgeSizeSim = 1 - Math.abs(sig1.numEdges - sig2.numEdges) / Math.max(sig1.numEdges, sig2.numEdges, 1);
  return 0.4 * labelSim + 0.3 * typeSim + 0.15 * nodeSizeSim + 0.15 * edgeSizeSim;
}

exports.handler = async (event) => {
  const method = event?.requestContext?.http?.method || event?.httpMethod;
  const path = event?.rawPath || event?.path || '/';
  const qs = event.queryStringParameters || {};
  const sub = getSub(event);

  if (method === 'OPTIONS') return json(200, { ok: true });

  const table = process.env.SESSIONS_TABLE;
  if (!table) return json500('missing_table');

  if (path === '/health') {
    return json(200, { ok: true, service: 'synduck', env: process.env.ENV || 'dev' });
  }

  if (path === '/guest/session' && method === 'POST') {
    const token = generateId('gs');
    const nowMs = Date.now();
    const pk = `gs#${token}`;
    const dayKey = new Date(nowMs).toISOString().slice(0, 10);
    await ddb.send(new PutCommand({
      TableName: table,
      Item: {
        pk,
        token,
        createdAt: nowMs,
        expiresAt: nowMs + GUEST_EXPIRE_MS,
        dailyCreates: 0,
        dayKey,
      },
    }));
    return json(200, { ok: true, token });
  }

  // Share management
  if (path === '/share') {
    const graphId = String(qs.graphId || '').trim();
    if (!graphId) return json400('missing_graphId');
    const gpk = `graph#${graphId}`;
    const gres = await ddb.send(new GetCommand({ TableName: table, Key: { pk: gpk } }));
    if (!gres.Item) return json404('graph_not_found');
    const graph = gres.Item;
    if (!sub || !isOwnerRole(getUserRole(event, graph))) return json403('must_be_owner');
    if (method === 'POST') {
      const newToken = generateId('st');
      await ddb.send(new PutCommand({ TableName: table, Item: { ...graph, shareToken: newToken } }));
      return json(200, { ok: true, shareToken: newToken });
    } else if (method === 'DELETE') {
      await ddb.send(new PutCommand({ TableName: table, Item: { ...graph, shareToken: null } }));
      return json(200, { ok: true });
    }
    return json400('method_not_allowed');
  }

  // Permissions management
  if (path === '/permissions') {
    const graphId = String(qs.graphId || '').trim();
    if (!graphId) return json400('missing_graphId');
    const gpk = `graph#${graphId}`;
    const gres = await ddb.send(new GetCommand({ TableName: table, Key: { pk: gpk } }));
    if (!gres.Item) return json404('graph_not_found');
    const graph = gres.Item;
    if (!sub || !isOwnerRole(getUserRole(event, graph))) return json403('must_be_owner');
    if (method === 'GET') {
      return json(200, { ok: true, permissions: graph.permissions || {} });
    }
    if (method === 'POST') {
      let payload;
      try {
        payload = JSON.parse(event.body || '{}');
      } catch {
        return json400('invalid_json');
      }
      const userSub = String(payload.userSub || '').trim();
      const roleStr = String(payload.role || '').trim().toLowerCase();
      if (!userSub || !ROLES.has(roleStr)) return json400('missing_or_invalid_userSub_role');
      const newPerms = { ...(graph.permissions || {}), [userSub]: roleStr };
      await ddb.send(new PutCommand({ TableName: table, Item: { ...graph, permissions: newPerms } }));
      return json(200, { ok: true });
    }
    if (method === 'DELETE') {
      const userSub = String(qs.userSub || '').trim();
      if (!userSub) return json400('missing_userSub');
      const newPerms = { ...(graph.permissions || {}) };
      delete newPerms[userSub];
      await ddb.send(new PutCommand({ TableName: table, Item: { ...graph, permissions: Object.keys(newPerms).length ? newPerms : undefined } }));
      return json(200, { ok: true });
    }
    return json400('method_not_allowed');
  }

  // Graphs
  if (path === '/graphs') {
    if (method === 'GET') {
      const graphId = String(qs.id || '').trim();
      if (graphId) {
        // Fetch single graph
        const pk = `graph#${graphId}`;
        const gres = await ddb.send(new GetCommand({ TableName: table, Key: { pk } }));
        if (!gres.Item) return json404('not_found');
        const graph = gres.Item;
        const role = getUserRole(event, graph);
        if (!canRead(role)) return json403('no_access');
        const out = {
          id: graphId,
          name: graph.name,
          visibility: graph.visibility,
          owner: graph.owner,
          createdAt: graph.createdAt,
          userRole: role,
        };
        if (isOwnerRole(role)) {
          out.shareToken = graph.shareToken;
          out.permissions = graph.permissions || {};
        }
        return json(200, { ok: true, graph: out });
      } else {
        // List graphs
        const scanRes = await ddb.send(new ScanCommand({ TableName: table, Limit: 100 }));
        const rawGraphs = (scanRes.Items || []).filter((it) => it.pk.startsWith('graph#'));
        const type = qs.type || (sub ? 'my' : 'public');
        const filteredGraphs = rawGraphs.filter((graph) => {
          const role = getUserRole(event, graph);
          if (type === 'public') {
            return graph.visibility === 'public';
          } else if (type === 'my') {
            return !!role;
          }
          return canRead(role);
        });
        const items = filteredGraphs.map((graph) => {
          const role = getUserRole(event, graph);
          return {
            id: graph.pk.slice(6),
            name: graph.name,
            visibility: graph.visibility,
            owner: graph.owner,
            createdAt: graph.createdAt,
            userRole: role,
          };
        }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        return json(200, { ok: true, items });
      }
    }
    if (method === 'POST') {
      let effectiveOwner = sub;
      let isGuestMode = false;
      if (!sub) {
        const guestTokenStr = getGuestToken(event);
        if (!guestTokenStr) return json401('unauthorized');
        const gpk = `gs#${guestTokenStr}`;
        const gres = await ddb.send(new GetCommand({ TableName: table, Key: { pk: gpk } }));
        const gs = gres.Item;
        if (!gs) return json403('invalid_guest_session');
        const nowMs = Date.now();
        if (nowMs > gs.expiresAt) return json403('guest_session_expired');
        const nowDay = new Date(nowMs).toISOString().slice(0, 10);
        let newDailyCreates = gs.dailyCreates;
        if (nowDay !== gs.dayKey) {
          newDailyCreates = 1;
        } else {
          newDailyCreates = gs.dailyCreates + 1;
          if (newDailyCreates > 3) return json403('guest_daily_limit_reached');
        }
        await ddb.send(new PutCommand({
          TableName: table,
          Item: {
            ...gs,
            dailyCreates: newDailyCreates,
            dayKey: nowDay,
          },
        }));
        effectiveOwner = getGuestId(guestTokenStr);
        isGuestMode = true;
      }
      let payload;
      try { payload = JSON.parse(event.body || '{}'); } catch { return json400('invalid_json'); }
      const name = String(payload.name || '').trim();
      if (!name || name.length > 100) return json400('invalid_name');
      const graphId = generateId('g');
      const pk = `graph#${graphId}`;
      const createdAt = new Date().toISOString();
      const visibility = isGuestMode ? 'private' : (payload.visibility === 'public' ? 'public' : 'private');
      await ddb.send(new PutCommand({
        TableName: table,
        Item: {
          pk,
          name,
          visibility,
          owner: effectiveOwner,
          createdAt,
          ...(isGuestMode ? {} : { permissions: { [effectiveOwner]: 'owner' } }),
          shareToken: null,
        },
      }));
      return json(201, { ok: true, id: graphId });
    }
    if (method === 'DELETE') {
      const graphId = String(qs.id || '').trim();
      if (!graphId) return json400('missing_id');
      const pk = `graph#${graphId}`;
      const gres = await ddb.send(new GetCommand({ TableName: table, Key: { pk } }));
      if (!gres.Item) return json404('not_found');
      const graph = gres.Item;
      if (!isOwnerRole(getUserRole(event, graph))) return json403('not_owner');
      await ddb.send(new DeleteCommand({ TableName: table, Key: { pk } }));
      // Cascade delete nodes
      const nres = await ddb.send(new ScanCommand({ TableName: table, Limit: 1000 }));
      for (const it of (nres.Items || [])) {
        if (it.pk.startsWith(`node#${graphId}#`)) {
          await ddb.send(new DeleteCommand({ TableName: table, Key: { pk: it.pk } }));
        }
      }
      // Cascade delete edges
      const eres = await ddb.send(new ScanCommand({ TableName: table, Limit: 1000 }));
      for (const it of (eres.Items || [])) {
        if (it.pk.startsWith(`edge#${graphId}#`)) {
          await ddb.send(new DeleteCommand({ TableName: table, Key: { pk: it.pk } }));
        }
      }
      return json(200, { ok: true });
    }
  }

  // Common graph access check for nodes/edges
  const graphId = String(qs.graphId || '').trim();
  if (!graphId) return json400('missing_graphId');
  const gpk = `graph#${graphId}`;
  const gres = await ddb.send(new GetCommand({ TableName: table, Key: { pk: gpk } }));
  if (!gres.Item) return json404('graph_not_found');
  const graph = gres.Item;
  const role = getUserRole(event, graph);
  if (method === 'GET') {
    if (!canRead(role)) return json403('no_read_access');
  } else {
    if (!canWrite(role)) return json403('no_write_access');
  }

  // Nodes
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
      let payload;
      try { payload = JSON.parse(event.body || '{}'); } catch { return json400('invalid_json'); }
      const label = String(payload.label || '').trim();
      const note = String(payload.note || '').trim();
      if (!label) return json400('missing_label');
      const nodeLocalId = generateId('n');
      const pk = `${prefix}${nodeLocalId}`;
      const createdAt = new Date().toISOString();
      await ddb.send(new PutCommand({
        TableName: table,
        Item: { pk, graphId, label, note, createdAt },
      }));
      return json(201, { ok: true, id: nodeLocalId });
    }
    return json400('method_not_allowed');
  }

  // Edges
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
          type: it.type || 'references',
          annotation: it.annotation || '',
          note: it.note,
          createdAt: it.createdAt,
        }));
      return json(200, { ok: true, items });
    }
    if (method === 'POST') {
      let payload;
      try { payload = JSON.parse(event.body || '{}'); } catch { return json400('invalid_json'); }
      const from = String(payload.from || '').trim();
      const to = String(payload.to || '').trim();
      const note = String(payload.note || '').trim();
      const type = String(payload.type || 'references').trim().toLowerCase();
      const annotation = String(payload.annotation || '').trim();
      if (!from || !to || from === to) return json400('invalid_endpoints');
      if (!EDGE_TYPES.has(type)) return json400('invalid_edge_type');
      const edgeLocalId = generateId('e');
      const pk = `${prefix}${edgeLocalId}`;
      const createdAt = new Date().toISOString();
      await ddb.send(new PutCommand({
        TableName: table,
        Item: { pk, graphId, from, to, type, annotation, note, createdAt },
      }));
      return json(201, { ok: true, id: edgeLocalId });
    }
    if (method === 'PUT') {
      const edgeId = String(qs.id || '').trim();
      if (!edgeId) return json400('missing_id');
      const epk = `${prefix}${edgeId}`;
      const eres = await ddb.send(new GetCommand({ TableName: table, Key: { pk: epk } }));
      if (!eres.Item) return json404('edge_not_found');
      let payload;
      try { payload = JSON.parse(event.body || '{}'); } catch { return json400('invalid_json'); }
      const type = String(payload.type || eres.Item.type || 'references').trim().toLowerCase();
      const annotation = String(payload.annotation ?? eres.Item.annotation ?? '').trim();
      const note = String(payload.note ?? eres.Item.note ?? '').trim();
      if (!EDGE_TYPES.has(type)) return json400('invalid_edge_type');
      await ddb.send(new PutCommand({
        TableName: table,
        Item: { ...eres.Item, type, annotation, note },
      }));
      return json(200, { ok: true, id: edgeId });
    }
    if (method === 'DELETE') {
      const from = String(qs.from || '').trim();
      const to = String(qs.to || '').trim();
      if (!from || !to) return json400('missing_endpoints');
      const res = await ddb.send(new ScanCommand({ TableName: table, Limit: 500 }));
      const match = (res.Items || []).find((it) =>
        it.pk.startsWith(prefix) &&
        ((it.from === from && it.to === to) || (it.from === to && it.to === from))
      );
      if (!match) return json404('edge_not_found');
      await ddb.send(new DeleteCommand({ TableName: table, Key: { pk: match.pk } }));
      return json(200, { ok: true });
    }
  }

  if (path === '/graphs/similar') {
    if (method !== 'GET') return json(405, 'method_not_allowed');

    const targetGraphId = String(qs.targetGraphId || '').trim();
    if (!targetGraphId) return json400('missing targetGraphId');

    const targetGraph = await getGraph(table, targetGraphId);
    if (!targetGraph) return json404('target_graph_not_found');

    const role = getUserRole(event, targetGraph);
    if (!canRead(role)) return json403('no_access_to_target');

    const targetNodes = await scanNodes(table, targetGraphId);
    const targetEdges = await scanEdges(table, targetGraphId);
    const sig1 = computeSignature(targetNodes, targetEdges);

    const publicGraphs = await scanPublicGraphs(table);

    const candidates = [];
    for (const pg of publicGraphs) {
      const pgId = pg.pk.slice(6);
      if (pgId === targetGraphId) continue;

      const pgNodes = await scanNodes(table, pgId);
      const pgEdges = await scanEdges(table, pgId);
      const sig2 = computeSignature(pgNodes, pgEdges);

      const score = similarityScore(sig1, sig2);
      candidates.push({ id: pgId, name: pg.name, score });
    }

    candidates.sort((a, b) => b.score - a.score);
    const top = candidates.slice(0, 5);

    return json(200, { ok: true, items: top });
  }

  return json(404, { ok: false, error: 'not_found' });
};
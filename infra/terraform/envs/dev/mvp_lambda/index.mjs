export const handler = async (event) => {
  const path = event?.rawPath || event?.path || '/';
  if (path === '/health') {
    return {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ok: true, service: 'synduck', env: 'dev' }),
    };
  }

  return {
    statusCode: 404,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ok: false, error: 'not_found' }),
  };
};

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { testPng } from '../helpers/desktop';
export function testMcpServer() {
  const server = new Server(
    { name: 'canvas-test-fixture', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'echo',
        description: 'Echo a text and return a test image.',
        inputSchema: {
          type: 'object',
          properties: { text: { type: 'string' } },
          required: ['text'],
          additionalProperties: false,
        },
      },
      {
        name: 'failure',
        description: 'A declared tool failure.',
        inputSchema: { type: 'object', properties: {} },
      },
    ],
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    if (request.params.name === 'failure')
      return { isError: true, content: [{ type: 'text', text: 'Expected remote failure' }] };
    return {
      content: [
        { type: 'text', text: String(request.params.arguments?.text) },
        { type: 'image', data: testPng().toString('base64'), mimeType: 'image/png' },
      ],
      structuredContent: {
        echo: request.params.arguments?.text,
        model_key_inherited: !!process.env.LLM_API_KEY,
        explicit_key_inherited: !!process.env.MCP_TEST_SECRET,
      },
    };
  });
  return server;
}
if (process.argv.includes('--stdio')) await testMcpServer().connect(new StdioServerTransport());

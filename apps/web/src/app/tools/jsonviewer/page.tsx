'use client';

import { useState, useMemo, ReactNode } from 'react';

interface Node {
  id: string;
  label: string;
  kind: "primitive" | "key" | "index" | "object" | "array";
  children: Node[];
  x: number;
  y: number;
  r: number;
  subtreeWidth: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  isSquare?: boolean;
  width?: number;
  height?: number;
}

function buildTree(obj: any): Node {
  const id = `n${Math.random().toString(36).slice(2, 9)}`;

  if (obj === null || obj === undefined) {
    return {
      id,
      label: "null",
      kind: "primitive",
      children: [],
      x: 0,
      y: 0,
      r: 0,
      subtreeWidth: 0,
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
    };
  }

  if (typeof obj !== "object") {
    const str = typeof obj === "string" ? `"${obj}"` : String(obj);
    const label = str.length > 12 ? str.slice(0, 12) + "..." : str;
    return {
      id,
      label,
      kind: "primitive",
      children: [],
      x: 0,
      y: 0,
      r: 0,
      subtreeWidth: 0,
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
    };
  }

  const isArray = Array.isArray(obj);
  const kind = isArray ? "array" : "object";
  const children: Node[] = [];
  const entries = isArray ? obj.map((v, i) => [i.toString(), v] as [string, any]) : Object.entries(obj as Record<string, any>);

  entries.forEach(([k, v]) => {
    const keyId = `k${Math.random().toString(36).slice(2, 9)}`;
    const keyNode: Node = {
      id: keyId,
      label: isArray ? `[${k}]` : `"${k}"`,
      kind: isArray ? "index" : "key",
      children: [buildTree(v)],
      x: 0,
      y: 0,
      r: 0,
      subtreeWidth: 0,
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      isSquare: isArray,
    };
    children.push(keyNode);
  });

  return {
    id,
    label: "",
    kind,
    children,
    x: 0,
    y: 0,
    r: 0,
    subtreeWidth: 0,
    minX: 0,
    maxX: 0,
    minY: 0,
    maxY: 0,
  };
}

function computeLayout(node: Node): number {
  node.children.forEach((child) => computeLayout(child));

  if (node.children.length === 0) {
    if (node.isSquare) {
      node.width = 50;
      node.height = 50;
      node.r = 25;
      node.subtreeWidth = 50;
    } else {
      node.r = node.kind === "primitive" ? 20 : 22;
      node.subtreeWidth = node.r * 2;
    }
    return node.subtreeWidth;
  }

  let total = 0;
  const spacing = 45;
  node.children.forEach((child, i) => {
    total += child.subtreeWidth;
    if (i < node.children.length - 1) total += spacing;
  });
  node.subtreeWidth = Math.max(100, total);
  return node.subtreeWidth;
}

function assignPositions(node: Node, centerX: number, y: number) {
  node.x = centerX;
  node.y = y;

  const spacing = 45;
  let currX = centerX - node.subtreeWidth / 2;
  node.children.forEach((child) => {
    const childCenter = currX + child.subtreeWidth / 2;
    assignPositions(child, childCenter, y + 100);
    currX += child.subtreeWidth + spacing;
  });

  // Compute bbox
  if (node.children.length === 0) {
    const half = node.r;
    node.minX = node.x - half;
    node.maxX = node.x + half;
    node.minY = node.y - half;
    node.maxY = node.y + half;
  } else {
    node.minX = Infinity;
    node.maxX = -Infinity;
    node.minY = Infinity;
    node.maxY = -Infinity;
    node.children.forEach((c) => {
      node.minX = Math.min(node.minX, c.minX);
      node.maxX = Math.max(node.maxX, c.maxX);
      node.minY = Math.min(node.minY, c.minY);
      node.maxY = Math.max(node.maxY, c.maxY);
    });
    const padding = 30;
    node.minX -= padding;
    node.maxX += padding;
    node.minY = Math.min(node.minY, node.y - 20);
    node.maxY += padding;
  }
}

const getNodeColor = (kind: Node["kind"]): string => {
  switch (kind) {
    case "key":
      return "#3b82f6"; // blue
    case "index":
      return "#f59e0b"; // orange
    case "primitive":
      return "#10b981"; // green
    case "object":
      return "#8b5cf6"; // violet
    case "array":
      return "#06b6d4"; // cyan
    default:
      return "#6b7280";
  }
};

const renderNode = (node: Node): ReactNode => (
  <g key={node.id}>
    {/* Enclosing circle for groups */}
    {(node.kind === "object" || node.kind === "array") && (
      <circle
        cx={node.x}
        cy={(node.y + node.maxY) / 2}
        r={(node.maxY - node.y + (node.maxX - node.minX) / 2) / 2 + 40}
        fill="none"
        stroke="#a855f7"
        strokeWidth="2.5"
        strokeDasharray="8, 6"
        opacity={0.6}
      />
    )}
    {/* Node shape */}
    {node.isSquare ? (
      <rect
        x={node.x - 25}
        y={node.y - 25}
        width={50}
        height={50}
        rx={10}
        fill={getNodeColor(node.kind)}
        stroke="#111827"
        strokeWidth="2"
      />
    ) : (
      <circle
        cx={node.x}
        cy={node.y}
        r={node.r}
        fill={getNodeColor(node.kind)}
        stroke="#111827"
        strokeWidth="2"
      />
    )}
    {/* Label */}
    <text
      x={node.x}
      y={node.y + 2}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize="12"
      fontWeight="600"
      fill="white"
      style={{ pointerEvents: "none" }}
    >
      {node.label}
    </text>
    {/* Lines to children */}
    {node.children.map((child) => (
      <line
        key={`line-${child.id}`}
        x1={node.x}
        y1={node.y + node.r}
        x2={child.x}
        y2={child.y - child.r}
        stroke="#4b5563"
        strokeWidth="2.5"
        strokeLinecap="round"
        markerEnd="url(#arrowhead)"
      />
    ))}
    {/* Children */}
    {node.children.map(renderNode)}
  </g>
);

export default function JSONViewer() {
  const [jsonText, setJsonText] = useState(`{
  "glossary": {
    "title": "example glossary",
    "GlossDiv": {
      "title": "S",
      "GlossSeeAlso": ["G", "E"]
    }
  }
}`);
  const [parsed, setParsed] = useState<unknown>(null);
  const [error, setError] = useState<string>("");

  const tree = useMemo(() => {
    if (error || !parsed) return null;
    try {
      const rootNode = buildTree(parsed);
      computeLayout(rootNode);
      assignPositions(rootNode, 900, 40);
      return rootNode;
    } catch (e) {
      console.error(e);
      return null;
    }
  }, [parsed, error]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setJsonText(text);
    try {
      const obj = JSON.parse(text);
      setParsed(obj);
      setError("");
    } catch (err: any) {
      setParsed(null);
      setError(err.message);
    }
  };

  const svgWidth = 1800;
  const svgHeight = tree ? tree.maxY + 200 : 800;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 -webkit-background-clip-text bg-clip-text text-transparent mb-12 text-center">
          JSON Viewer - Graphic Visualization
        </h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <div>
            <label className="block text-lg font-semibold mb-4 text-gray-800">
              JSON Input
            </label>
            <textarea
              value={jsonText}
              onChange={handleChange}
              className="w-full h-96 p-6 border-2 border-gray-200 rounded-xl font-mono text-sm bg-white shadow-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none resize-vertical transition-all duration-200"
              placeholder="Paste your JSON here..."
            />
          </div>
          <div className="bg-white rounded-xl shadow-lg border p-6 h-96 overflow-hidden">
            {error ? (
              <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 text-red-800 font-mono text-sm whitespace-pre-wrap h-full flex flex-col justify-center">
                <div className="font-bold mb-2 text-lg">❌ Invalid JSON</div>
                <div>{error}</div>
              </div>
            ) : !parsed ? (
              <div className="text-gray-500 italic text-center py-12 h-full flex items-center justify-center">
                Enter valid JSON above to see the graphic tree view
              </div>
            ) : !tree ? (
              <div className="text-gray-500 italic text-center py-12 h-full flex items-center justify-center">
                Building visualization...
              </div>
            ) : (
              <div className="w-full h-full overflow-auto bg-gray-50 rounded-lg">
                <svg width="100%" height="100%" viewBox={`0 0 ${svgWidth} ${svgHeight}`}>
                  <defs>
                    <marker
                      id="arrowhead"
                      markerWidth="12"
                      markerHeight="8"
                      refX="11"
                      refY="4"
                      orient="auto"
                    >
                      <polygon points="0 0, 12 4, 0 8" fill="#4b5563" />
                    </marker>
                  </defs>
                  <rect width={svgWidth} height={svgHeight} fill="none" />
                  {renderNode(tree)}
                </svg>
              </div>
            )}
          </div>
        </div>
        <div className="mt-8 text-sm text-gray-600 text-center">
          Features: Keys (blue circles), Array items (orange squares), Primitives (green circles), Hierarchy groups (purple dashed circles), Fully expanded.
        </div>
      </div>
    </div>
  );
}
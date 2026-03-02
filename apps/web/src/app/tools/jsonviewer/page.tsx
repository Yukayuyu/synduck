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
  depth?: number;
}

function buildTree(obj: unknown, depth = 0): Node {
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
      depth,
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
      depth,
    };
  }

  const isArray = Array.isArray(obj);
  const kind = isArray ? "array" : "object";
  const children: Node[] = [];
  const entries: Array<[string, unknown]> = isArray
    ? obj.map((v, i) => [i.toString(), v] as [string, unknown])
    : Object.entries(obj as Record<string, unknown>);

  entries.forEach(([k, v]) => {
    const keyId = `k${Math.random().toString(36).slice(2, 9)}`;
    const keyLabel = (isArray ? `[${k}]` : `"${k}"`).length > 15 ? (isArray ? `[${k.slice(0,12)}...]` : `"${k.slice(0,12)}..."`) : (isArray ? `[${k}]` : `"${k}"`);
    const keyNode: Node = {
      id: keyId,
      label: keyLabel,
      kind: isArray ? "index" : "key",
      children: [buildTree(v, depth + 1)],
      x: 0,
      y: 0,
      r: 0,
      subtreeWidth: 0,
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      depth,
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
    depth,
  };
}

function computeLayout(node: Node): number {
  node.children.forEach((child) => computeLayout(child));

  if (node.children.length === 0) {
    node.r = node.kind === "primitive" ? 20 : 22;
    node.subtreeWidth = node.r * 2;
    return node.subtreeWidth;
  }

  // Set shape dimensions for non-leaves
  if (node.isSquare) {
    node.width = 100;
    node.height = 24;
    node.r = 50; // half width for connection point
  } else {
    node.r = 28;
  }

  // Adjust subtreeWidth for single child (key/index)
  if (node.children.length === 1) {
    node.subtreeWidth = Math.max(120, node.children[0].subtreeWidth + 20);
  } else {
    let total = 0;
    const spacing = 55;
    node.children.forEach((child, i) => {
      total += child.subtreeWidth;
      if (i < node.children.length - 1) total += spacing;
    });
    node.subtreeWidth = Math.max(120, total);
  }
  return node.subtreeWidth;
}

function assignPositions(node: Node, centerX: number, y: number) {
  node.x = centerX;
  node.y = y;

  const spacing = 55;
  let currX = centerX - node.subtreeWidth / 2;
  node.children.forEach((child) => {
    const childCenter = currX + child.subtreeWidth / 2;
    assignPositions(child, childCenter, y + 120);
    currX += child.subtreeWidth + spacing;
  });

  // Compute bbox
  if (node.children.length === 0) {
    const halfW = node.width ? node.width / 2 : node.r;
    const halfH = node.height ? node.height / 2 : node.r;
    node.minX = node.x - halfW;
    node.maxX = node.x + halfW;
    node.minY = node.y - halfH;
    node.maxY = node.y + halfH;
  } else {
    // Own shape bbox
    const ownHalfW = node.width ? node.width / 2 : node.r;
    const ownHalfH = node.height ? node.height / 2 : node.r;
    node.minX = node.x - ownHalfW;
    node.maxX = node.x + ownHalfW;
    node.minY = node.y - ownHalfH;
    node.maxY = node.y + ownHalfH;

    // Union with children
    node.children.forEach((c) => {
      node.minX = Math.min(node.minX!, c.minX);
      node.maxX = Math.max(node.maxX!, c.maxX);
      node.minY = Math.min(node.minY!, c.minY);
      node.maxY = Math.max(node.maxY!, c.maxY);
    });

    const padding = 45;
    node.minX -= padding;
    node.maxX += padding;
    node.minY = Math.min(node.minY!, node.y - 25);
    node.maxY += padding;
  }
}

const getEnclosingColor = (depth: number): string => {
  const pastels = [
    '#f0fdf4', // light green
    '#eff6ff', // light blue
    '#fdf4ff', // light violet
    '#fef3c7', // light yellow
    '#f1f5f9', // light slate
    '#fdf2f8', // light pink
  ];
  return pastels[depth % pastels.length];
};

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

const renderNode = (node: Node): ReactNode => {
  const bottomOffset = node.isSquare && node.height ? node.height / 2 : node.r;
  return (
    <g key={node.id}>
      {/* Enclosing circle for groups */}
      {(node.kind === "object" || node.kind === "array") && (
        <circle
          cx={node.x}
          cy={(node.y + node.maxY) / 2}
          r={(node.maxY - node.y + (node.maxX - node.minX) / 2) / 2 + 45}
          fill={getEnclosingColor(node.depth || 0)}
          stroke="#c084fc"
          strokeWidth="1.8"
          strokeDasharray="6, 4"
          opacity={0.85}
          pointerEvents="none"
        />
      )}
      {/* Node shape */}
      {node.isSquare && node.width && node.height ? (
        <rect
          x={node.x - node.width / 2}
          y={node.y - node.height / 2}
          width={node.width}
          height={node.height}
          rx={6}
          ry={6}
          fill={getNodeColor(node.kind)}
          stroke="#111827"
          strokeWidth="2.2"
        />
      ) : (
        <circle
          cx={node.x}
          cy={node.y}
          r={node.r || 22}
          fill={getNodeColor(node.kind)}
          stroke="#111827"
          strokeWidth="2.2"
        />
      )}
      {/* Label */}
      <text
        x={node.x}
        y={node.y + (node.isSquare ? 2 : 4)}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={node.isSquare ? "11" : "12"}
        fontWeight="600"
        fill="white"
        style={{ pointerEvents: "none" }}
      >
        {node.label}
      </text>
      {/* Lines to children - curved */}
      {node.children.map((child) => {
        const startY = node.y + bottomOffset;
        const endY = child.y - (child.isSquare && child.height ? child.height / 2 : child.r);
        const midY = (startY + endY) / 2;
        return (
          <path
            key={`line-${child.id}`}
            d={`M ${node.x} ${startY} Q ${node.x} ${midY} ${child.x} ${endY}`}
            fill="none"
            stroke="#4b5563"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            markerEnd="url(#arrowhead)"
          />
        );
      })}
      {/* Children */}
      {node.children.map(renderNode)}
    </g>
  );
};

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
      console.error(e ?? "Layout error");
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
    } catch (err: unknown) {
      setParsed(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const svgWidth = 1900;
  const svgHeight = tree ? tree.maxY + 250 : 800;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-7xl mx-auto">
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
          Enhanced: Filled pastel hierarchy areas by depth, curved non-overlapping arrows, horizontal array indices for clarity. Keys (blue), Indices (orange rects), Primitives (green), Objects/Arrays (colored areas), fully expanded.
        </div>
      </div>
    </div>
  );
}
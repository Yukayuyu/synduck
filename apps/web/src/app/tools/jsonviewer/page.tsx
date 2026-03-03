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

  // Set shape for non-leaves
  node.r = 26;
  if (node.isSquare) {
    node.width = 110;
    node.height = 26;
    node.r = node.width! / 2;
  }

  // Compute subtreeWidth
  if (node.children.length === 1) {
    // KV horizontal
    const child = node.children[0];
    const keySpan = node.width || (node.r * 2);
    node.subtreeWidth = keySpan + 90 + child.subtreeWidth;
  } else {
    // Container: multiple KV pairs
    let total = 0;
    const spacing = 65;
    node.children.forEach((child, i) => {
      total += child.subtreeWidth;
      if (i < node.children.length - 1) total += spacing;
    });
    node.subtreeWidth = Math.max(220, total);
  }
  return node.subtreeWidth;
}

function assignPositions(node: Node, centerX: number, y: number) {
  node.x = centerX;
  node.y = y;

  const ownHalfW = node.width ? node.width / 2 : (node.r || 22);
  const ownHalfH = node.height ? node.height / 2 : ownHalfW;
  node.minX = node.x - ownHalfW;
  node.maxX = node.x + ownHalfW;
  node.minY = node.y - ownHalfH;
  node.maxY = node.y + ownHalfH;

  if (node.children.length === 0) {
    return;
  }

  if (node.children.length === 1) {
    // KV horizontal same row
    const child = node.children[0];
    const linkGap = 45;
    const childR = child.r || 22;
    child.x = node.x + ownHalfW + linkGap + childR;
    child.y = node.y;
    assignPositions(child, child.x, child.y);
  } else {
    // Structural: children below
    const childY = y + 150;
    const spacing = 65;
    let offsetX = centerX - node.subtreeWidth / 2;
    node.children.forEach((child) => {
      const childCenterX = offsetX + child.subtreeWidth / 2;
      assignPositions(child, childCenterX, childY);
      offsetX += child.subtreeWidth + spacing;
    });
  }

  // Union bbox
  node.children.forEach((c) => {
    node.minX = Math.min(node.minX!, c.minX);
    node.maxX = Math.max(node.maxX!, c.maxX);
    node.minY = Math.min(node.minY!, c.minY);
    node.maxY = Math.max(node.maxY!, c.maxY);
  });
  const padding = 50;
  node.minX -= padding;
  node.maxX += padding;
  node.maxY += padding;
  node.minY = Math.min(node.minY!, y - 30);
}

const getEnclosingColor = (depth: number): string => {
  const pastels = [
    '#f0fdf4',
    '#eff6ff',
    '#fdf4ff',
    '#fef3c7',
    '#f1f5f9',
    '#fdf2f8',
  ];
  return pastels[depth % pastels.length];
};

const getNodeColor = (kind: Node["kind"]): string => {
  switch (kind) {
    case "key":
      return "#3b82f6";
    case "index":
      return "#f59e0b";
    case "primitive":
      return "#10b981";
    case "object":
      return "#8b5cf6";
    case "array":
      return "#06b6d4";
    default:
      return "#6b7280";
  }
};

const flattenNodes = (node: Node): Node[] => [node, ...node.children.flatMap(flattenNodes)];

const flattenEdges = (node: Node): Array<{ from: Node; to: Node }> => [
  ...node.children.map((c) => ({ from: node, to: c })),
  ...node.children.flatMap(flattenEdges),
];

const renderNode = (node: Node): ReactNode => (
  <g key={node.id}>
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
      assignPositions(rootNode, 1200, 60);
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

  const svgWidth = 2400;
  const svgHeight = tree ? tree.maxY + 350 : 800;

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
                  {/* Layer 1: hierarchy areas */}
                  {flattenNodes(tree)
                    .filter((n) => n.kind === "object" || n.kind === "array")
                    .map((n) => (
                      <circle
                        key={`area-${n.id}`}
                        cx={n.x}
                        cy={(n.y + n.maxY) / 2}
                        r={(n.maxY - n.y + (n.maxX - n.minX) / 2) / 2 + 45}
                        fill={getEnclosingColor(n.depth || 0)}
                        stroke="#c084fc"
                        strokeWidth="1.8"
                        strokeDasharray="6, 4"
                        opacity={0.5}
                        pointerEvents="none"
                      />
                    ))}
                  {/* Layer 2: links with distinct styles */}
                  {flattenEdges(tree).map(({ from, to }) => {
                    const isKvEdge = from.kind === "key" || from.kind === "index";
                    let d: string;
                    let strokeWidth: string;
                    let strokeColor: string;
                    let markerEnd: string | undefined;
                    const fromR = from.width ? from.width / 2 : (from.r || 26);
                    const fromH = from.height ? from.height / 2 : fromR;
                    const toR = to.width ? to.width / 2 : (to.r || 22);
                    const toH = to.height ? to.height / 2 : toR;

                    if (isKvEdge) {
                      // Thick horizontal key->value
                      const startX = from.x + fromR;
                      const startY = from.y;
                      const endX = to.x - toR;
                      const endY = to.y;
                      d = `M ${startX} ${startY} L ${endX} ${endY}`;
                      strokeWidth = "4.5";
                      strokeColor = "#1e3a8a";
                      markerEnd = undefined;
                    } else {
                      // Thin curved structural parent->kv
                      const startX = from.x;
                      const startY = from.y + fromH;
                      const endX = to.x;
                      const endY = to.y - toH;
                      const midY = (startY + endY) / 2;
                      d = `M ${startX} ${startY} Q ${startX} ${midY} ${endX} ${endY}`;
                      strokeWidth = "1.8";
                      strokeColor = "#6b7280";
                      markerEnd = "url(#arrowhead)";
                    }

                    return (
                      <path
                        key={`line-${from.id}-${to.id}`}
                        d={d}
                        fill="none"
                        stroke={strokeColor}
                        strokeWidth={strokeWidth}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        markerEnd={markerEnd}
                      />
                    );
                  })}
                  {/* Layer 3: nodes */}
                  {flattenNodes(tree).map(renderNode)}
                </svg>
              </div>
            )}
          </div>
        </div>
        <div className="mt-8 text-sm text-gray-600 text-center">
          Phase A: Key-value pairs now horizontally paired with thick blue links. Structural parent-child links thin curved gray arrows. Full-expanded, stable.
        </div>
      </div>
    </div>
  );
}
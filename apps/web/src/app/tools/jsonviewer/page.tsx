'use client';

import { useState, ReactNode } from 'react';

export default function JSONViewer() {
  const [jsonText, setJsonText] = useState(`{
  "example": {
    "nested": "data",
    "array": [1, 2, 3],
    "bool": true,
    "null": null
  }
}`);
  const [parsed, setParsed] = useState<unknown>(null);
  const [error, setError] = useState<string>('');

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const text = e.target.value;
    setJsonText(text);
    try {
      const obj = JSON.parse(text);
      setParsed(obj);
      setError('');
    } catch (err: any) {
      setParsed(null);
      setError(err.message);
    }
  };

  const renderTree = (obj: unknown, key?: string): ReactNode => {
    if (obj == null) return <span className="text-gray-500 font-mono">null</span>;

    if (typeof obj !== 'object') {
      let display = String(obj);
      if (typeof obj === 'string')
        display = `&quot;${obj.replace(/&/g, '&amp;').replace(/&quot;/g, '\\&quot;')}&quot;`;
      return <span className="font-mono text-sm text-black">{display}</span>;
    }

    const isArray = Array.isArray(obj);
    return (
      <details open={false} className="ml-4 border-l-2 border-gray-300 pl-2">
        <summary className="cursor-pointer list-none font-mono text-sm hover:bg-gray-100 p-2 rounded mb-1 select-none">
          {key && (
            <>
              <span className="text-green-600">&quot;</span>
              <span className="font-bold">{key}</span>
              <span className="text-green-600">&quot;</span>
              <span className="text-gray-600">:</span>
            </>
          )}
          <span className="text-blue-600 ml-1">{isArray ? '[...]' : '{...}'}</span>
        </summary>
        <div className="mt-2 space-y-1">
          {isArray
            ? (obj as any[]).map((item, idx) => (
                <div key={idx} className="ml-2">
                  <span className="text-orange-600">[{idx}]</span>
                  {renderTree(item, String(idx))}
                </div>
              ))
            : Object.entries(obj as Record<string, unknown>).map(([k, v]) => (
                <div key={k}>{renderTree(v, k)}</div>
              ))}
        </div>
      </details>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-12 text-center">
          JSON Viewer
        </h1>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          <div>
            <label className="block text-lg font-semibold mb-4 text-gray-800">JSON Input</label>
            <textarea
              value={jsonText}
              onChange={handleChange}
              className="w-full h-96 p-6 border-2 border-gray-200 rounded-xl font-mono text-sm bg-white shadow-lg focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none resize-vertical transition-all duration-200"
              placeholder='Paste your JSON here... e.g. {"key": "value"}'
            />
          </div>
          <div className="bg-white rounded-xl shadow-lg border p-6 h-96 overflow-auto">
            {error ? (
              <div className="bg-red-50 border-2 border-red-200 rounded-xl p-6 text-red-800 font-mono text-sm whitespace-pre-wrap">
                <div className="font-bold mb-2">❌ Invalid JSON</div>
                {error}
              </div>
            ) : parsed == null ? (
              <div className="text-gray-500 italic text-center py-12">
                Enter valid JSON above to see tree view
              </div>
            ) : (
              <div className="font-mono text-sm leading-relaxed">{renderTree(parsed)}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

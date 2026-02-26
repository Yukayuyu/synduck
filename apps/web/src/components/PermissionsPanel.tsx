'use client';

import { useEffect, useState, useCallback } from 'react';
import { fetchPermissions, addPermission, removePermission } from '@/lib/api';

interface Props {
  graphId: string;
}

export default function PermissionsPanel({ graphId }: Props) {
  const [permissions, setPermissions] = useState<Record<string, string>>({});
  const [userSub, setUserSub] = useState('');
  const [role, setRole] = useState<'editor' | 'viewer'>('viewer');
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const perms = await fetchPermissions(graphId);
      setPermissions(perms);
    } catch (e) {
      setStatus(`Load failed: ${String(e)}`);
    }
  }, [graphId]);

    useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const handleAdd = async () => {
    if (!userSub.trim()) return;
    try {
      await addPermission(graphId, { userSub: userSub.trim(), role });
      setUserSub('');
      setStatus('Added');
      await load();
    } catch (e) {
      setStatus(`Error: ${String(e)}`);
    }
  };

  const handleRemove = async (targetSub: string) => {
    if (!confirm(`Remove permission for ${targetSub.slice(0, 8)}...?`)) return;
    try {
      await removePermission(graphId, targetSub);
      setStatus('Removed');
      await load();
    } catch (e) {
      setStatus(`Error: ${String(e)}`);
    }
  };

  return (
    <section style={{ paddingBottom: 16, borderBottom: '1px solid var(--border)' }}>
      <h3>Permissions ({Object.keys(permissions).length})</h3>
      <div style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        <input
          value={userSub}
          onChange={(e) => setUserSub(e.target.value)}
          placeholder="User sub (e.g. UUID from Cognito)"
          style={{ padding: 8 }}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
          <option value="editor">Editor</option>
          <option value="viewer">Viewer</option>
        </select>
        <button onClick={handleAdd} disabled={!userSub.trim()}>Add permission</button>
      </div>
      {status && <div className="muted" style={{ marginBottom: 8 }}>{status}</div>}
      <ul style={{ maxHeight: 200, overflow: 'auto', gap: 4, display: 'grid' }}>
        {Object.entries(permissions).map(([sub, r]) => (
          <li key={sub} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 4 }}>
            <span>{sub.slice(0, 8)}... <b>{r}</b></span>
            <button className="btn" style={{ fontSize: 12 }} onClick={() => handleRemove(sub)}>Remove</button>
          </li>
        ))}
      </ul>
      <button className="btn" onClick={load} style={{ marginTop: 8, width: '100%' }}>Refresh</button>
    </section>
  );
}
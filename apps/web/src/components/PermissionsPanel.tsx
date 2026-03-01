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
    <section
      style={{ borderBottom: '1px solid var(--border-light)', paddingBottom: 'var(--spacing-lg)' }}
    >
      <h3>
        Permissions{' '}
        <span className="muted" style={{ fontSize: '0.875rem' }}>
          ({Object.keys(permissions).length})
        </span>
      </h3>
      <div style={{ display: 'grid', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}>
        <div>
          <label
            style={{
              display: 'block',
              marginBottom: 'var(--spacing-xs)',
              fontSize: '0.875rem',
              color: 'var(--text-secondary)',
            }}
          >
            User ID (Cognito sub)
          </label>
          <input
            value={userSub}
            onChange={(e) => setUserSub(e.target.value)}
            placeholder="e.g. abc123-def456..."
          />
        </div>
        <div>
          <label
            style={{
              display: 'block',
              marginBottom: 'var(--spacing-xs)',
              fontSize: '0.875rem',
              color: 'var(--text-secondary)',
            }}
          >
            Role
          </label>
          <select value={role} onChange={(e) => setRole(e.target.value as 'editor' | 'viewer')}>
            <option value="editor">Editor (full access)</option>
            <option value="viewer">Viewer (read-only)</option>
          </select>
        </div>
        <button className="btn" onClick={handleAdd} disabled={!userSub.trim()}>
          + Grant Access
        </button>
      </div>
      {status && (
        <div className="muted" style={{ marginBottom: 8 }}>
          {status}
        </div>
      )}
      <div style={{ maxHeight: '20vh', overflow: 'auto' }}>
        <ul style={{ display: 'grid', gap: 'var(--spacing-xs)' }}>
          {Object.entries(permissions).map(([sub, r]) => (
            <li
              key={sub}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: 'var(--spacing-sm)',
              }}
            >
              <span>
                {sub.slice(0, 12)}...{' '}
                <span style={{ color: 'var(--accent)', fontWeight: 600 }}>{r.toUpperCase()}</span>
              </span>
              <button
                className="btn danger"
                style={{ fontSize: '0.75rem', padding: 'var(--spacing-xs)' }}
                onClick={() => handleRemove(sub)}
              >
                Revoke
              </button>
            </li>
          ))}
          {Object.keys(permissions).length === 0 && (
            <li
              style={{
                padding: 'var(--spacing-md)',
                textAlign: 'center',
                color: 'var(--text-secondary)',
              }}
            >
              No additional permissions set.
              <div
                className="muted"
                style={{ fontSize: '0.875rem', marginTop: 'var(--spacing-sm)' }}
              >
                You are the owner.
              </div>
            </li>
          )}
        </ul>
      </div>
      <button className="btn" onClick={load} style={{ marginTop: 8, width: '100%' }}>
        Refresh
      </button>
    </section>
  );
}

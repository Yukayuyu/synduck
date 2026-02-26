'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createGraph, deleteGraph, fetchGraphs, GraphItem } from '@/lib/api';
import { isLoggedIn } from '@/lib/auth';
import { LoginControls } from '../LoginControls';

export default function GraphsPage() {
  const [myGraphs, setMyGraphs] = useState<GraphItem[]>([]);
  const [publicGraphs, setPublicGraphs] = useState<GraphItem[]>([]);
  const [tab, setTab] = useState<'my' | 'public'>('my');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const canEdit = isLoggedIn();

  const load = async () => {
    setLoading(true);
    try {
      const [my, pub] = await Promise.all([fetchGraphs('my'), fetchGraphs('public')]);
      setMyGraphs(my);
      setPublicGraphs(pub);
    } catch (e) {
      setStatus(`Load failed: ${String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const add = async () => {
    if (!name.trim()) return;
    setStatus('creating…');
    try {
      await createGraph({ name: name.trim(), visibility: 'private' });
      setName('');
      setStatus('created');
      await load();
    } catch (e) {
      setStatus(`error: ${String(e)}`);
    }
  };

  const del = async (id: string) => {
    if (!confirm(`Delete graph ${id}?`)) return;
    try {
      await deleteGraph(id);
      await load();
    } catch (e) {
      setStatus(`delete failed: ${String(e)}`);
    }
  };

  const graphs = tab === 'my' ? myGraphs : publicGraphs;

  return (
    <main style={{ padding: 32, maxWidth: 800, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>Graphs</h1>
        <LoginControls />
      </header>

      {status ? <div style={{ color: 'orange', marginBottom: 16 }}>{status}</div> : null}

      {canEdit ? (
        <div style={{ marginBottom: 24, padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
          <h3>Create new graph</h3>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Graph name"
            style={{ marginRight: 8, padding: 8 }}
          />
          <button onClick={add} disabled={!name.trim() || loading}>Create</button>
          <label style={{ marginLeft: 16 }}>
            <input type="checkbox" checked /> Public
          </label>
        </div>
      ) : null}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn" onClick={() => setTab('my')} disabled={tab === 'my' || !canEdit}>My</button>
        <button className="btn" onClick={() => setTab('public')} disabled={tab === 'public'}>Public</button>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <ul style={{ display: 'grid', gap: 12 }}>
          {graphs.map((g) => (
            <li key={g.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
              <div>
                <Link href={`/g/${g.id}`} style={{ fontWeight: 600, fontSize: 18 }}>{g.name}</Link>
                <div className="muted" style={{ fontSize: 14 }}>{new Date(g.createdAt).toLocaleString()} · {g.visibility}</div>
              </div>
              {tab === 'my' && (
                <button className="btn" style={{ color: 'red' }} onClick={() => del(g.id)}>Delete</button>
              )}
            </li>
          ))}
          {graphs.length === 0 && <p>No graphs {tab === 'my' ? '(login to create)' : ''}.</p>}
        </ul>
      )}
    </main>
  );
}
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createGraph, createGuestSession, deleteGraph, fetchGraphs, GraphItem } from '@/lib/api';
import { isLoggedIn, hasSession } from '@/lib/auth';
import { LoginControls } from '../LoginControls';

export default function GraphsPage() {
  const [myGraphs, setMyGraphs] = useState<GraphItem[]>([]);
  const [publicGraphs, setPublicGraphs] = useState<GraphItem[]>([]);
  const [tab, setTab] = useState<'my' | 'public'>('my');
  const [name, setName] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const loggedIn = isLoggedIn();
  const hasSessionState = hasSession();
  const showGuestPrompt = !hasSessionState;
  const canEdit = hasSessionState;

  const load = async () => {
    setLoading(true);
    try {
      const [my, pub] = await Promise.all([fetchGraphs('my'), fetchGraphs('public')]);
      setMyGraphs(my);
      setPublicGraphs(pub);
    } catch (e) {
      const msg = String(e);
      if (msg.includes('guest_session_expired') && !loggedIn) {
        try {
          await createGuestSession();
          const [my, pub] = await Promise.all([fetchGraphs('my'), fetchGraphs('public')]);
          setMyGraphs(my);
          setPublicGraphs(pub);
          setStatus('Guest session refreshed.');
          return;
        } catch (retryErr) {
          setStatus(`Load failed: ${String(retryErr)}`);
          return;
        }
      }
      setStatus(`Load failed: ${msg}`);
    } finally {
      setLoading(false);
    }
  };

  const startGuest = async () => {
    try {
      await createGuestSession();
      setStatus('Guest session started. Limit: 3 private graphs per day.');
      await load();
    } catch (e) {
      setStatus(`Guest start failed: ${String(e)}`);
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
      setTab('my');
      setStatus('created');
      await load();
    } catch (e) {
      const msg = String(e);
      if (msg.includes('guest_session_expired') && !loggedIn) {
        try {
          await createGuestSession();
          await createGraph({ name: name.trim(), visibility: 'private' });
          setName('');
          setTab('my');
          setStatus('created');
          await load();
          return;
        } catch (retryErr) {
          setStatus(`error: ${String(retryErr)}`);
          return;
        }
      }
      setStatus(`error: ${msg}`);
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
    <main style={{ padding: 'var(--spacing-xl) 5%', maxWidth: 900, margin: '0 auto' }}>
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: 'var(--spacing-md)',
          marginBottom: 'var(--spacing-xl)',
        }}
      >
        <div>
          <h1>My Graphs</h1>
          <div className="muted" style={{ fontSize: '1rem' }}>
            Create and manage your personal graphs
          </div>
        </div>
        <LoginControls />
      </header>

      {status ? (
        <div
          className={`muted ${status.includes('error') || status.includes('failed') ? 'danger' : ''}`}
          style={{
            marginBottom: 'var(--spacing-md)',
            padding: 'var(--spacing-sm)',
            background: 'rgba(239,68,68,0.1)',
            borderRadius: 'var(--radius-sm)',
          }}
        >
          {status}
        </div>
      ) : null}

      {showGuestPrompt ? (
        <section
          style={{
            marginBottom: 'var(--spacing-xl)',
            padding: 'var(--spacing-lg)',
            background: 'var(--panel)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-light)',
            textAlign: 'center',
          }}
        >
          <h2>ゲストで試す</h2>
          <p className="muted" style={{ marginBottom: 'var(--spacing-md)' }}>
            ログインせずにグラフを作成できます（1日3つまで、非公開のみ）
          </p>
          <button className="btn" onClick={startGuest} style={{ fontSize: '1.1rem' }}>
            ゲストで始める
          </button>
        </section>
      ) : null}
      {canEdit ? (
        <section
          style={{
            marginBottom: 'var(--spacing-xl)',
            padding: 'var(--spacing-lg)',
            background: 'var(--panel)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--border-light)',
          }}
        >
          <h2>Create New Graph</h2>
          <div
            style={{ display: 'grid', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-md)' }}
          >
            <div>
              <label
                style={{
                  display: 'block',
                  marginBottom: 'var(--spacing-xs)',
                  fontSize: '0.875rem',
                  color: 'var(--text-secondary)',
                }}
              >
                Name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. My Project Roadmap"
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
              {!loggedIn && (
                <div className="muted" style={{ fontSize: '0.875rem' }}>
                  ゲスト制限: 1日3つ、非公開のみ
                </div>
              )}
              {loggedIn ? (
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--spacing-xs)',
                    fontSize: '0.875rem',
                    color: 'var(--text-secondary)',
                  }}
                >
                  <input type="checkbox" checked={false} disabled style={{ cursor: 'default' }} /> Make public
                </label>
              ) : null}
              <button className="btn" onClick={add} disabled={!name.trim() || loading}>
                {loading ? 'Creating...' : '+ Create Graph'}
              </button>
            </div>
          </div>
        </section>
      ) : null}

      <div style={{ display: 'flex', gap: 'var(--spacing-sm)', marginBottom: 'var(--spacing-lg)' }}>
        <button
          className={`btn ${tab === 'my' ? '' : 'secondary'}`}
          onClick={() => setTab('my')}
          disabled={showGuestPrompt}
        >
          My Graphs
        </button>
        <button
          className={`btn ${tab === 'public' ? '' : 'secondary'}`}
          onClick={() => setTab('public')}
        >
          Explore Public
        </button>
      </div>

      {loading ? (
        <div
          style={{
            padding: 'var(--spacing-xl)',
            textAlign: 'center',
            color: 'var(--text-secondary)',
          }}
        >
          <div style={{ fontSize: '1.5rem', marginBottom: 'var(--spacing-md)' }}>
            Loading graphs...
          </div>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--spacing-md)', minHeight: 400 }}>
          {graphs.map((g) => (
            <Link
              key={g.id}
              href={`/notes?id=${g.id}`}
              className="btn secondary"
              style={{
                padding: 'var(--spacing-lg)',
                justifyContent: 'flex-start',
                textAlign: 'left',
                border: '1px solid var(--border-light)',
                background: 'var(--panel)',
                transition: 'all 0.15s ease',
                textDecoration: 'none',
              }}
            >
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    fontSize: '1.125rem',
                    fontWeight: 600,
                    marginBottom: 'var(--spacing-xs)',
                  }}
                >
                  {g.name}
                </div>
                <div className="muted">
                  {new Date(g.createdAt).toLocaleDateString()} ·{' '}
                  {g.visibility === 'public' ? '🌐 Public' : '🔒 Private'}
                </div>
              </div>
              {tab === 'my' && (
                <button
                  className="btn danger"
                  style={{ fontSize: '0.875rem' }}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    del(g.id);
                  }}
                >
                  Delete
                </button>
              )}
            </Link>
          ))}
          {graphs.length === 0 && (
            <div
              style={{ padding: '5rem 2rem', textAlign: 'center', color: 'var(--text-secondary)' }}
            >
              {tab === 'my' ? (
                <>
                  <div style={{ fontSize: '2rem', marginBottom: 'var(--spacing-md)' }}>
                    📊 No graphs yet
                  </div>
                  <div style={{ fontSize: '1.125rem', marginBottom: 'var(--spacing-xl)' }}>
                    Get started by creating your first graph above.
                  </div>
                  <div className="muted" style={{ maxWidth: 500, margin: '0 auto' }}>
                    SynDuck lets you build visual knowledge graphs with nodes, edges, notes, and
                    sharing.
                  </div>
                </>
              ) : (
                <>
                  <div style={{ fontSize: '2rem', marginBottom: 'var(--spacing-md)' }}>
                    🌍 No public graphs
                  </div>
                  <div className="muted">
                    Community graphs will appear here. Create your own and make it public!
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </main>
  );
}

import { useEffect, useState } from 'react';
import {
  Download,
  Upload,
  X,
  History,
  ShieldCheck,
  AlertTriangle,
  FileJson,
  LoaderCircle,
} from 'lucide-react';
import { MAX_PROJECT_BYTES, type ProjectFile, type ProjectPreview } from '@acc/domain';
import { api } from './api';

interface Recovery {
  id: string;
  name: string;
  created_at: string;
}

export function ProjectDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => Promise<void>;
}) {
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [candidate, setCandidate] = useState<{
    file: unknown;
    name: string;
    preview: ProjectPreview;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [recovery, setRecovery] = useState<Recovery[]>([]);
  useEffect(() => {
    void api<Recovery[]>('/project/recovery')
      .then(setRecovery)
      .catch((e) => setError(e.message));
  }, []);
  const showError = (e: unknown) => setError(e instanceof Error ? e.message : '操作失败，请重试。');
  const validate = async (file: unknown, name: string) => {
    setError('');
    setNotice('');
    setConfirmed(false);
    setCandidate(null);
    const preview = await api<ProjectPreview>('/project/validate', { project: file });
    setCandidate({ file, name, preview });
  };
  const readFile = async (file: File) => {
    setWorking(true);
    setCandidate(null);
    setError('');
    try {
      if (file.size > MAX_PROJECT_BYTES) throw new Error('文件超过 12 MiB 限制。');
      let parsed: unknown;
      try {
        parsed = JSON.parse(await file.text());
      } catch {
        throw new Error('无法读取 JSON，请选择原生项目备份文件。');
      }
      await validate(parsed, file.name);
    } catch (e) {
      showError(e);
    } finally {
      setWorking(false);
    }
  };
  const download = async () => {
    setWorking(true);
    setError('');
    setNotice('');
    try {
      const project = await api<ProjectFile>('/project/export');
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(project)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `context-canvas-${project.exported_at.slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice('已生成项目备份，下载文件包含完整对话、原文和上下文快照。');
    } catch (e) {
      showError(e);
    } finally {
      setWorking(false);
    }
  };
  const loadRecovery = async (point: Recovery) => {
    setWorking(true);
    setError('');
    try {
      await validate(
        await api<ProjectFile>(`/project/recovery/${point.id}`),
        `恢复点 · ${new Date(point.created_at).toLocaleString('zh-CN')}`,
      );
    } catch (e) {
      showError(e);
    } finally {
      setWorking(false);
    }
  };
  const restore = async () => {
    if (!candidate || !confirmed || working) return;
    setWorking(true);
    setError('');
    try {
      const current = candidate.preview.current;
      await api('/project/import', {
        project: candidate.file,
        confirm_replace: true,
        expected: {
          workspace_id: current.workspace_id,
          revision: current.revision,
          snapshot_hash: current.snapshot_hash,
        },
      });
      await onImported();
    } catch (e) {
      showError(e);
    } finally {
      setWorking(false);
    }
  };
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!working) onClose();
      }}
    >
      <section
        className="modal project-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="modal-close"
          disabled={working}
          onClick={onClose}
          aria-label="关闭备份与恢复"
        >
          <X size={18} />
        </button>
        <span className="overline">YOUR WORK, YOUR COPY</span>
        <h2 id="project-title">备份与恢复</h2>
        <p className="project-description">
          保存整张思考地图，包括对话、摘录来源、画布位置和每轮上下文。文件包含原文，请妥善保管。
        </p>
        {!candidate ? (
          <>
            <div className="project-actions">
              <button className="secondary" disabled={working} onClick={() => void download()}>
                <Download size={17} />
                <span>
                  <strong>导出项目备份</strong>
                  <small>下载原生 JSON 文件</small>
                </span>
              </button>
              <label className={`file-picker ${working ? 'disabled' : ''}`}>
                <Upload size={17} />
                <span>
                  <strong>选择备份文件</strong>
                  <small>先校验，再确认导入</small>
                </span>
                <input
                  aria-label="选择项目备份文件"
                  type="file"
                  accept="application/json,.json"
                  disabled={working}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void readFile(file);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            <div className="recovery-heading">
              <History size={14} />
              <h3>导入前的恢复点</h3>
            </div>
            {recovery.length ? (
              <div className="recovery-list">
                {recovery.map((point) => (
                  <div key={point.id}>
                    <span>
                      <strong>{point.name}</strong>
                      <small>{new Date(point.created_at).toLocaleString('zh-CN')}</small>
                    </span>
                    <button
                      className="text-button"
                      disabled={working}
                      onClick={() => void loadRecovery(point)}
                    >
                      预览恢复
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="empty-note">
                每次成功导入时，都会自动保留替换前的工作区。目前还没有恢复点。
              </p>
            )}
          </>
        ) : (
          <>
            <div className="import-file">
              <FileJson size={20} />
              <span>
                <strong>{candidate.name}</strong>
                <small>格式、完整性及来源引用校验通过</small>
              </span>
              <ShieldCheck size={18} />
            </div>
            <div className="import-summary">
              <h3>{candidate.preview.name}</h3>
              <div>
                {Object.entries(candidate.preview.counts).map(([key, count]) => (
                  <span key={key}>
                    <b>{count}</b>
                    {
                      (
                        {
                          conversations: '对话',
                          turns: '消息',
                          excerpts: '摘录',
                          nodes: '节点',
                          contexts: '上下文快照',
                        } as Record<string, string>
                      )[key]
                    }
                  </span>
                ))}
              </div>
            </div>
            {candidate.preview.warnings.map((w) => (
              <div className="notice" key={w}>
                <AlertTriangle size={14} />
                {w}
              </div>
            ))}
            <p className="import-impact">
              这会替换「{candidate.preview.current.name}」当前的 {candidate.preview.current.nodes}{' '}
              个节点。原工作区会自动保存为恢复点，所有导入内容保留原始 ID 与来源记录。
            </p>
            <label className="import-confirm">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={working}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              我确认用此备份替换当前工作区
            </label>
            <div className="modal-actions">
              <button
                className="secondary"
                disabled={working}
                onClick={() => {
                  setCandidate(null);
                  setConfirmed(false);
                  setError('');
                }}
              >
                返回
              </button>
              <button
                className="primary"
                disabled={!confirmed || working}
                onClick={() => void restore()}
              >
                确认导入并替换
              </button>
            </div>
          </>
        )}
        {working && (
          <div className="project-status" role="status">
            <LoaderCircle size={14} className="spin" />
            正在处理…
          </div>
        )}
        {notice && (
          <p className="project-status" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="project-error" role="alert">
            {error}
          </p>
        )}
      </section>
    </div>
  );
}

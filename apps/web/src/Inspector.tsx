import { ScanLine, ArrowUpRight, Check, X, AlertTriangle, Layers, Pin } from 'lucide-react';
import type { ContextPackage } from '@acc/domain';
import type { ClientState } from './api';

const roles: Record<string, string> = {
  selected: '本轮选择',
  pinned: '长期固定',
  current: '当前对话',
  branch_origin: '分支来源',
  related: '相关来源',
  historical: '历史资料',
};
const reasons: Record<string, string> = {
  'explicitly excluded': '你明确排除了此内容',
  'source overlaps explicitly excluded content': '来源与已排除内容重叠，为避免再次引入而排除',
  'answer depends on an excluded source': '这条回答依赖已排除的来源，也已排除',
  'rejected by lifecycle policy': '内容已被否决',
  'omitted to fit context budget': '超过上下文预算',
  'explicit source exceeds budget; sending blocked': '指定原文超出预算，已阻止发送',
  'duplicate source content': '同一来源的重复内容',
  'source content hash or selector mismatch': '来源已变化，需要重新选择',
  'missing reference': '来源不存在',
};
export function Inspector({
  state,
  pkg,
  historical,
  selected,
  onLocate,
}: {
  state: ClientState;
  pkg: ContextPackage | null;
  historical: boolean;
  selected: string[];
  onLocate: (id: string) => void;
}) {
  const title = (id: string) => state.nodes.find((n) => n.id === id)?.title || id;
  return (
    <aside className="inspector" aria-label="上下文检查器">
      <div className="panel-heading">
        <span>
          <ScanLine size={17} />
          上下文检查器
        </span>
        <span className="tiny-tag">CONTEXT</span>
      </div>
      <div className="inspector-scroll">
        <div className="inspector-intro">
          <h2>让每一次回答，有据可循。</h2>
          <p>
            {historical ? '这次回答保存的输入快照。' : '发送前，看看模型会收到哪些内容。'}
            包含在输入中，不代表模型一定关注它。
          </p>
        </div>
        {!pkg ? (
          <>
            <div className="context-placeholder">
              <Layers size={28} strokeWidth={1.3} />
              <h3>上下文，由你决定</h3>
              <p>
                在画布上选择或固定卡片，
                <br />
                输入问题后点击「预览上下文」。
              </p>
            </div>
            <div className="selection-summary">
              <span>
                <Check size={14} />
                本轮选择
              </span>
              <b>{selected.length}</b>
            </div>
            <div className="selection-summary">
              <span>
                <Pin size={14} />
                长期固定
              </span>
              <b>{state.workspace.settings.pinned_node_ids.length}</b>
            </div>
            <div className="selection-summary">
              <span>
                <X size={14} />
                明确排除
              </span>
              <b>{state.workspace.settings.excluded_node_ids.length}</b>
            </div>
            <div className="quiet-note">
              固定的内容会保留到下一轮。排除始终优先，也会阻止同一来源从其他路径重新进入。
            </div>
          </>
        ) : (
          <>
            <div className={`package-status ${pkg.sendable ? '' : 'blocked'}`}>
              {pkg.sendable ? <Check size={14} /> : <AlertTriangle size={14} />}
              {historical
                ? '已保存的模型输入'
                : pkg.sendable
                  ? '上下文已编译 · 等待发送'
                  : '需处理后才能发送'}
            </div>
            <div className="token-meter">
              <div>
                <span>上下文预算 · 保守估算</span>
                <b>
                  {pkg.budget.used_context_tokens.toLocaleString()}{' '}
                  <small>/ {pkg.budget.target_context_tokens.toLocaleString()}</small>
                </b>
              </div>
              <progress
                value={pkg.budget.used_context_tokens}
                max={pkg.budget.target_context_tokens}
              />
              <p>含问题与元数据的输入估算：{pkg.budget.estimated_input_tokens.toLocaleString()}</p>
            </div>
            <h3 className="section-label">
              包含在模型输入中 <span>{pkg.items.length}</span>
            </h3>
            {pkg.items.length === 0 && (
              <p className="empty-note">只发送当前问题，没有额外上下文。</p>
            )}
            {pkg.items.map((item, index) => (
              <button
                key={`${item.node_id}-${item.source_id}-${index}`}
                className="context-item"
                onClick={() => onLocate(item.node_id)}
              >
                <div className="context-item-top">
                  <span className={`role ${item.role}`}>{roles[item.role]}</span>
                  <span>{item.token_estimate} est.</span>
                </div>
                <h4>
                  {title(item.node_id)}
                  <ArrowUpRight size={13} />
                </h4>
                <p>{item.content}</p>
                <div className="item-explanation">
                  {item.state} · {item.score.toFixed(2)}
                  <span title={item.reason}>
                    {item.reason.includes('explicit') ? '由你明确指定' : '按结构关系纳入'}
                  </span>
                </div>
              </button>
            ))}
            {pkg.excluded.length > 0 && (
              <>
                <h3 className="section-label">
                  已排除 <span>{pkg.excluded.length}</span>
                </h3>
                {pkg.excluded.map((item, i) => (
                  <button className="excluded-item" key={i} onClick={() => onLocate(item.node_id)}>
                    <X size={13} />
                    <span>
                      <strong>{title(item.node_id)}</strong>
                      <small>{reasons[item.reason] || item.reason}</small>
                    </span>
                  </button>
                ))}
              </>
            )}
            {pkg.conflicts.map((c, i) => (
              <div className="notice" key={i}>
                <AlertTriangle size={16} />
                <span>
                  {c.type === 'content_mismatch'
                    ? '来源内容已变化'
                    : c.type === 'missing_reference'
                      ? '找不到引用来源'
                      : '存在已替代的历史内容'}
                  <small>{c.resolution}</small>
                </span>
              </div>
            ))}
            {pkg.diagnostics.map((d) => (
              <div className="notice" key={d}>
                {d}
              </div>
            ))}
            <details className="package-details">
              <summary>查看完整输入记录</summary>
              <pre>{JSON.stringify(pkg, null, 2)}</pre>
            </details>
          </>
        )}
      </div>
      <div className="inspector-foot">
        <span className="status-dot" />
        {state.provider.demo
          ? '演示模式 · 内容不会发送给外部模型'
          : `发送至 ${state.provider.name} · ${state.provider.model || '尚未配置模型'}`}
      </div>
    </aside>
  );
}

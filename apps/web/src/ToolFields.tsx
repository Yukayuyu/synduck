type Schema = {
  type?: string;
  title?: string;
  description?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  enum?: unknown[];
  items?: Schema;
};
export const fieldName = (key: string) =>
  (
    ({
      owner: '账号或组织',
      repo: '仓库',
      path: '文件位置',
      text: '文字内容',
      query: '查找内容',
      url: '网址',
      title: '标题',
      body: '内容',
      name: '名称',
      content: '新内容',
      command: '执行内容',
      timeout_seconds: '最长等待（秒）',
      server_id: '服务',
      tool: '操作',
      arguments: '操作内容',
      summary: '操作说明',
      stdin: '输入内容',
      operation: '操作',
      capture_id: '来源画面',
      key: '按键',
      delta: '滚动量',
    }) as Record<string, string>
  )[key] || key.replaceAll('_', ' ');
export function ToolFields({
  schema,
  value,
  onChange,
  disabled = false,
  depth = 0,
}: {
  schema: unknown;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  disabled?: boolean;
  depth?: number;
}) {
  const fields = (schema || {}) as Schema;
  if (depth > 4 || !fields.properties)
    return <p className="quiet-note">请在画布中描述要完成的操作，AI 会帮你准备需要的内容。</p>;
  return (
    <div className="tool-fields">
      {Object.entries(fields.properties)
        .slice(0, 40)
        .map(([key, field]) => {
          const label = field.title || fieldName(key);
          const current = value[key];
          const set = (next: unknown) => onChange({ ...value, [key]: next });
          if (field.type === 'object')
            return (
              <fieldset key={key}>
                <legend>{label}</legend>
                <ToolFields
                  schema={field}
                  value={(current as Record<string, unknown>) || {}}
                  onChange={set}
                  disabled={disabled}
                  depth={depth + 1}
                />
              </fieldset>
            );
          if (field.type === 'array')
            return (
              <fieldset key={key}>
                <legend>{label}</legend>
                {(Array.isArray(current) ? current : []).map((item, index) => (
                  <div className="tool-array-item" key={index}>
                    {field.items?.type === 'object' ? (
                      <ToolFields
                        schema={field.items}
                        value={item as Record<string, unknown>}
                        onChange={(next) =>
                          set((current as unknown[]).map((item, i) => (i === index ? next : item)))
                        }
                        disabled={disabled}
                        depth={depth + 1}
                      />
                    ) : (
                      <input
                        aria-label={label + ' ' + (index + 1)}
                        value={String(item)}
                        disabled={disabled}
                        onChange={(e) =>
                          set(
                            (current as unknown[]).map((item, i) =>
                              i === index ? e.target.value : item,
                            ),
                          )
                        }
                      />
                    )}
                    <button
                      disabled={disabled}
                      onClick={() => set((current as unknown[]).filter((_, i) => i !== index))}
                    >
                      移除
                    </button>
                  </div>
                ))}
                <button
                  disabled={disabled || (Array.isArray(current) && current.length >= 40)}
                  onClick={() =>
                    set([
                      ...(Array.isArray(current) ? current : []),
                      field.items?.type === 'object' ? {} : '',
                    ])
                  }
                >
                  添加一项
                </button>
              </fieldset>
            );
          return (
            <label key={key}>
              {label}
              {fields.required?.includes(key) ? ' *' : ''}
              {field.enum ? (
                <select
                  aria-label={label}
                  disabled={disabled}
                  value={String(current ?? '')}
                  onChange={(e) =>
                    set(field.enum?.find((option) => String(option) === e.target.value))
                  }
                >
                  <option value="">请选择</option>
                  {field.enum.map((option) => (
                    <option key={String(option)} value={String(option)}>
                      {String(option)}
                    </option>
                  ))}
                </select>
              ) : field.type === 'boolean' ? (
                <input
                  aria-label={label}
                  type="checkbox"
                  checked={current === true}
                  disabled={disabled}
                  onChange={(e) => set(e.target.checked)}
                />
              ) : field.type === 'number' || field.type === 'integer' ? (
                <input
                  aria-label={label}
                  type="number"
                  value={current === undefined ? '' : String(current)}
                  disabled={disabled}
                  onChange={(e) => set(e.target.value === '' ? undefined : Number(e.target.value))}
                />
              ) : (
                <textarea
                  aria-label={label}
                  value={typeof current === 'string' ? current : ''}
                  disabled={disabled}
                  onChange={(e) => set(e.target.value)}
                />
              )}{' '}
              {field.description && <small>{field.description}</small>}
            </label>
          );
        })}
    </div>
  );
}
export function OperationDetails({ values }: { values: Record<string, unknown> }) {
  return (
    <dl className="operation-details">
      {Object.entries(values)
        .filter(([key, value]) => value !== undefined && key !== 'summary' && key !== 'capture_id')
        .map(([key, value]) => (
          <div key={key}>
            <dt>{fieldName(key)}</dt>
            <dd>
              {Array.isArray(value) ? (
                value.map((item, index) => (
                  <div key={index}>
                    {item && typeof item === 'object' ? (
                      <OperationDetails values={item as Record<string, unknown>} />
                    ) : (
                      <pre>{String(item ?? '')}</pre>
                    )}
                  </div>
                ))
              ) : value && typeof value === 'object' ? (
                <OperationDetails values={value as Record<string, unknown>} />
              ) : (
                <pre>{String(value ?? '')}</pre>
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}

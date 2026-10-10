import { DomainError } from '@acc/domain';

// Classify protocol metadata; never forward provider messages, URLs, tokens or
// additionalDetails to the browser, persistent turns or application logs.
export function codexError(error: unknown): DomainError {
  const value = error && typeof error === 'object' ? (error as Record<string, unknown>) : {};
  const info = value.codexErrorInfo;
  const kind = typeof info === 'string' ? info : '';
  const variants = [
    'httpConnectionFailed',
    'responseStreamConnectionFailed',
    'responseStreamDisconnected',
    'responseTooManyFailedAttempts',
  ];
  let status: number | undefined;
  let connection = false;
  if (info && typeof info === 'object') {
    for (const variant of variants) {
      const detail = (info as Record<string, unknown>)[variant];
      if (detail && typeof detail === 'object') {
        connection = true;
        const code = (detail as Record<string, unknown>).httpStatusCode;
        if (Number.isInteger(code) && Number(code) >= 100 && Number(code) <= 599)
          status = Number(code);
      }
    }
  }
  if (kind === 'unauthorized' || status === 401)
    return new DomainError(
      'codex_auth_expired',
      'Codex 授權已失效，請在「模型與登入」重新登入 ChatGPT。',
      502,
    );
  if (kind === 'usageLimitExceeded' || kind === 'sessionBudgetExceeded')
    return new DomainError(
      'codex_usage_limit',
      'Codex 使用額度已用完，請查看帳號的 Codex 用量並等待額度重設。',
      502,
    );
  if (kind === 'rateLimitExceeded' || status === 429)
    return new DomainError('codex_rate_limit', 'Codex 請求受到速率限制，請稍後重試。', 502);
  if (status === 403)
    return new DomainError(
      'codex_access_denied',
      'Codex 服務拒絕存取（HTTP 403），請確認帳號的模型權限與網路存取。',
      502,
    );
  if (kind === 'contextWindowExceeded')
    return new DomainError(
      'codex_context_limit',
      'Codex 上下文超過模型容量，請減少選取內容後重新預覽。',
      502,
    );
  if (kind === 'sandboxError')
    return new DomainError(
      'codex_sandbox_error',
      'Codex 執行環境初始化失敗，請確認本機 Codex 執行環境後重試。',
      502,
    );
  if (
    ['serverOverloaded', 'flexUnavailable', 'internalServerError'].includes(kind) ||
    (status && status >= 500)
  )
    return new DomainError(
      'codex_service_unavailable',
      'Codex 服務暫時無法回應，請稍後重試。',
      502,
    );
  if (['cyberPolicy', 'misalignmentPolicyViolation', 'tooManyDenials'].includes(kind))
    return new DomainError(
      'codex_policy_rejected',
      'Codex 未接受本次請求，請調整問題後重新預覽。',
      502,
    );

  // Some RPC failures carry only text. Recognize narrowly defined conditions
  // and return our own fixed explanation rather than displaying that text.
  const message = typeof value.message === 'string' ? value.message : '';
  if (/invalid schema|schema.*(?:invalid|not supported)|response_format/i.test(message))
    return new DomainError(
      'codex_schema_rejected',
      'Codex 拒絕回答的 JSON 格式規格，請更新應用程式後重試。',
      502,
    );
  if (
    /model.*(?:does not exist|not found|not supported|unsupported|not available)|unsupported model/i.test(
      message,
    )
  )
    return new DomainError(
      'codex_model_unavailable',
      '目前設定的 Codex 模型無法使用，請在「模型與登入」刷新模型列表並重新選擇。',
      502,
    );
  if (
    kind === 'badRequest' ||
    status === 400 ||
    [-32600, -32601, -32602].includes(Number(value.code))
  )
    return new DomainError(
      'codex_request_rejected',
      'Codex 拒絕請求參數或協定，請更新應用程式並檢查模型設定。',
      502,
    );
  if (connection)
    return new DomainError(
      'codex_connection_failed',
      'Codex 無法連接回答服務或回答串流中斷，請檢查網路、代理與防火牆後重試。',
      502,
    );
  return new DomainError(
    'codex_generation_failed',
    'Codex 未完成回答；登入成功不代表生成請求成功。請查看 Codex 診斷結果後重試。',
    502,
  );
}

export const GENERIC_USER_ERROR_MESSAGE =
  '⚠️ ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้งครับ';

type ErrorWithStatus = {
  name?: unknown;
  status?: unknown;
  statusCode?: unknown;
};

function redactSensitiveText(value: string): string {
  return value
    .replace(/((?:postgres(?:ql)?):\/\/)[^@\s]+@/gi, '$1[REDACTED]@')
    .replace(/(bearer\s+)[^\s]+/gi, '$1[REDACTED]')
    .replace(
      /(authorization|x-line-signature|x-authorization|api[_-]?key|reply[_-]?token|access[_-]?token|channel[_-]?(?:access[_-]?)?token|password|secret)\s*[:=]\s*["']?[^,\s}"']+/gi,
      '$1=[REDACTED]'
    );
}

export function getInternalErrorDetails(error: unknown): {
  name: string;
  message: string;
  stack?: string;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactSensitiveText(error.message),
      ...(error.stack ? { stack: redactSensitiveText(error.stack) } : {}),
    };
  }

  return {
    name: 'NonErrorThrown',
    message: redactSensitiveText(String(error)),
  };
}

export function logInternalError(context: string, error: unknown): void {
  console.error(context, getInternalErrorDetails(error));
}

/** Preserve known client errors while preventing arbitrary errors from becoming 4xx responses. */
export function getSafeHttpStatus(error: unknown): number {
  if (!error || typeof error !== 'object') {
    return 500;
  }

  const candidate = error as ErrorWithStatus;
  if (candidate.name === 'SignatureValidationFailed') {
    return 401;
  }

  const status = candidate.statusCode ?? candidate.status;
  return typeof status === 'number' && Number.isInteger(status) && status >= 400 && status < 500
    ? status
    : 500;
}

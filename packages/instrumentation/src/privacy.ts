export interface HttpBodyCaptureOptions {
  enabled: boolean;
  maxBytes: number;
}

const DEFAULT_MAX_BODY_BYTES = 4096;

export function httpBodyCaptureOptions(): HttpBodyCaptureOptions {
  return {
    enabled: process.env.CODEFLOW_CAPTURE_HTTP_BODIES === "1",
    maxBytes: numberFromEnv(process.env.CODEFLOW_MAX_HTTP_BODY_BYTES, DEFAULT_MAX_BODY_BYTES)
  };
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

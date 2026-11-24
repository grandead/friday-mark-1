// Stable machine-readable codes and English diagnostics. No user-facing copy here.
export const errorMessages = {
  heater_missing: 'The device has no heater installed.',
  hardware_unknown: 'The device did not confirm the required hardware.',
  unsupported: 'The setting is unavailable on this device.',
  not_confirmed: 'The device did not confirm the requested setting.',
  device_unreachable: 'Failed to obtain a response from the device.',
  invalid_device_state: 'The device returned an invalid state.',
  invalid_miio_registration: 'Expected a valid IPv4 address and a 32-character hexadecimal token.',
  invalid_hommyn_registration: 'Expected a HOMMYN device share URL containing an access token.',
  invalid_form: 'Invalid form fields. Names must contain 1 to 120 characters.',
  entity_not_found: 'The home, room or device model was not found.',
  model_required: 'A device model must be selected.',
  invalid_journal_query: 'Invalid journal query parameters.',
  invalid_audio_path: 'Invalid audio recording path.',
  audio_not_found: 'The audio recording is unavailable.',
  request_failed: 'The request failed.',
  internal_error: 'An internal error occurred.',
  processing_stopped: 'Processing was cancelled during server shutdown.',
  llm_timeout: 'Ollama request timed out.',
  llm_unavailable: 'Failed to obtain a response from Ollama.',
  llm_http_error: 'Ollama returned an HTTP error.',
  invalid_llm_reply: 'Ollama returned an empty or invalid response.',
  invalid_reply_language: 'The model did not return a Russian reply.',
  llm_reply_too_long: 'Ollama response exceeded the output token limit.',
  tools_not_allowed: 'Tool calls are not allowed in this request.',
  tools_not_configured: 'Home tools are not configured.',
  transcript_too_long: 'The transcript exceeds the conversation length limit.',
} as const;
export type ErrorCode = keyof typeof errorMessages;
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(errorMessages, value);
}
export class AppError extends Error {
  constructor(readonly code: ErrorCode, message: string = errorMessages[code], options?: ErrorOptions) {
    super(message, options);
    this.name = 'AppError';
  }
}
export function errorResponse(code: ErrorCode) {
  return { code, message: errorMessages[code] };
}
export function diagnosticError(error: unknown): string {
  return error instanceof AppError ? `${error.code}: ${error.message}` : String(error);
}

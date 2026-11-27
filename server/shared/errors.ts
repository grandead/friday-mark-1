// Stable machine-readable codes and English diagnostics. No user-facing copy here.
export const ERROR_MESSAGES = {
  recording_interrupted: 'The recording was interrupted.',
  invalid_audio_message: 'Invalid audio message.',
  interaction_queue_full: 'Interaction queue full',
  heater_missing: 'The device has no heater installed.',
  hardware_unknown: 'The device did not confirm the required hardware.',
  unsupported: 'The setting is unavailable on this device.',
  not_confirmed: 'The device did not confirm the requested setting.',
  device_rejected_command: 'The device rejected the command.',
  device_unreachable: 'Failed to obtain a response from the device.',
  invalid_device_command: 'Invalid device command arguments.',
  device_model_mismatch: 'The command belongs to another device model.',
  invalid_device_state: 'The device returned an invalid state.',
  invalid_miio_registration: 'Expected a valid IPv4 address and a 32-character hexadecimal token.',
  invalid_hommyn_registration:
    'Expected a HOMMYN ASP-100 share URL with a MAC address and a nonzero 32-character hexadecimal token.',
  invalid_form: 'Invalid form fields. Names must contain 1 to 120 characters.',
  entity_not_found: 'The home, room or device model was not found.',
  invalid_task_request: 'Invalid task fields or identifiers.',
  user_not_found: 'The user was not found.',
  task_not_found: 'The task was not found for this user.',
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
export type ErrorCode = keyof typeof ERROR_MESSAGES;
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_MESSAGES, value);
}
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string = ERROR_MESSAGES[code],
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}
export function errorResponse(code: ErrorCode) {
  return { code, message: ERROR_MESSAGES[code] };
}
export function publicError(error: unknown) {
  return errorResponse(error instanceof AppError ? error.code : 'internal_error');
}

export function diagnosticError(error: unknown): string {
  return error instanceof AppError ? `${error.code}: ${error.message}` : String(error);
}

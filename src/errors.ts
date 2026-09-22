type ErrorInit = {
  statusCode?: number;
  body?: unknown;
  uncertain?: boolean;
  cause?: unknown;
};

/**
 * Base error for failed SDK calls.
 * `uncertain` is true when a create may already have been issued.
 */
export class DokladoError extends Error {
  readonly statusCode: number | undefined;
  readonly body: unknown;
  readonly uncertain: boolean;

  constructor(message: string, init: ErrorInit = {}) {
    super(
      message,
      init.cause !== undefined ? { cause: init.cause } : undefined,
    );
    this.name = 'DokladoError';
    this.statusCode = init.statusCode;
    this.body = init.body;
    this.uncertain = init.uncertain === true;
  }
}

export class ConfigError extends DokladoError {
  override name = 'ConfigError';
}

export class InputError extends DokladoError {
  override name = 'InputError';
}

export class HttpError extends DokladoError {
  override name = 'HttpError';
}

export class ApiError extends DokladoError {
  override name = 'ApiError';
  readonly code: string;

  constructor(
    message: string,
    init: { statusCode: number; body: unknown; code: string },
  ) {
    super(message, {
      statusCode: init.statusCode,
      body: init.body,
      uncertain: false,
    });
    this.code = init.code;
  }
}

export class TimeoutError extends DokladoError {
  override name = 'TimeoutError';
}

export class NetworkError extends DokladoError {
  override name = 'NetworkError';
}

export class ResponseError extends DokladoError {
  override name = 'ResponseError';
}

import axios from 'axios';

/**
 * Base error class for all application errors
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly context?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * API error for HTTP request failures
 */
export class ApiError extends AppError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseData?: unknown
  ) {
    super(message, 'API_ERROR', { statusCode, responseData });
  }

  static fromAxiosError(err: unknown): ApiError {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      const data = err.response?.data;
      return new ApiError(
        `HTTP ${status}: ${JSON.stringify(data)}`,
        status,
        data
      );
    }
    return new ApiError(String(err));
  }

  static isAxiosError(err: unknown): boolean {
    return axios.isAxiosError(err);
  }
}

/**
 * Configuration error for file loading or parsing failures
 */
export class ConfigurationError extends AppError {
  constructor(
    message: string,
    public readonly filePath?: string
  ) {
    super(message, 'CONFIGURATION_ERROR', { filePath });
  }
}

/**
 * Validation error for response mismatches or data validation failures
 */
export class ValidationError extends AppError {
  constructor(
    message: string,
    public readonly expected?: unknown,
    public readonly actual?: unknown
  ) {
    super(message, 'VALIDATION_ERROR', { expected, actual });
  }
}

/**
 * External service error for third-party service failures (Sheets, Slack, AI)
 */
export class ExternalServiceError extends AppError {
  constructor(
    message: string,
    public readonly serviceName: string,
    public readonly originalError?: unknown
  ) {
    super(message, 'EXTERNAL_SERVICE_ERROR', { serviceName, originalError });
  }
}

/**
 * Domain and service-level error classes for Pravaaha Data Integration.
 * Consistent, typed errors across all persistence, auth, validation, and disruption services.
 */

export class ServiceError extends Error {
  public readonly code: string
  public readonly cause?: unknown

  constructor(message: string, code = 'SERVICE_ERROR', cause?: unknown) {
    super(message)
    this.name = this.constructor.name
    this.code = code
    this.cause = cause
    Object.setPrototypeOf(this, new.target.prototype)
  }
}

export class ConfigurationError extends ServiceError {
  constructor(message = 'Supabase client is not configured. Running in demo mode.') {
    super(message, 'CONFIGURATION_ERROR')
  }
}

export class AuthenticationError extends ServiceError {
  constructor(message = 'User is not authenticated.') {
    super(message, 'AUTHENTICATION_ERROR')
  }
}

export class AuthorizationError extends ServiceError {
  constructor(message = 'User lacks required permissions for this operation.') {
    super(message, 'AUTHORIZATION_ERROR')
  }
}

export class OrganizationMismatchError extends ServiceError {
  constructor(message = 'Requested resource belongs to a different organization.') {
    super(message, 'ORGANIZATION_MISMATCH')
  }
}

export class ValidationError extends ServiceError {
  public readonly validationErrors: string[]

  constructor(message: string, errors: string[] = []) {
    super(message, 'VALIDATION_ERROR')
    this.validationErrors = errors.length > 0 ? errors : [message]
  }
}

export class NotFoundError extends ServiceError {
  constructor(entityName: string, identifier?: string) {
    super(
      identifier ? `${entityName} with id '${identifier}' not found.` : `${entityName} not found.`,
      'NOT_FOUND'
    )
  }
}

export class DatabaseError extends ServiceError {
  constructor(message: string, cause?: unknown) {
    super(message, 'DATABASE_ERROR', cause)
  }
}

/** Parse the API-key setting shared by file and environment configuration. */
export function splitApiKeys(value: string | undefined | null): string[] {
  if (typeof value !== 'string') {
    return [];
  }
  return value
    .split(',')
    .map((key) => key.trim())
    .filter((key) => key.length > 0);
}

/** An authentication, rate-limit, or quota failure tied to the selected key. */
export class ApiKeyFailureError extends Error {
  /**
   * Which kind of failure it was, where the caller knows: 'auth' is a key the
   * vendor refused, 'quota' is a key that ran out of credit, 'rate' is a
   * request that was refused for being too many. The kinds differ in what
   * helps next: a spent credit can be answered from another pool, a refused
   * key cannot.
   */
  readonly kind?: 'auth' | 'quota' | 'rate';

  /**
   * When the spent credit comes back, as an epoch timestamp. The vendor says
   * so (Firecrawl answers with `resets_at`), and a cooldown that ends before
   * that only buys another refused request.
   */
  readonly resetAt?: number;

  constructor(message: string, kind?: 'auth' | 'quota' | 'rate', resetAt?: number) {
    super(message);
    this.name = 'ApiKeyFailureError';
    this.kind = kind;
    this.resetAt = resetAt;
  }
}

export function isApiKeyFailure(error: unknown): error is ApiKeyFailureError {
  return error instanceof ApiKeyFailureError;
}

const QUOTA_FAILURE_PATTERNS = [
  /\bquota\b/i,
  /\bpayment required\b/i,
  /\b(?:out of|insufficient|not enough)\s+(?:account\s+)?(?:balance|credits?)\b/i,
  /\b(?:balance|credits?)\s+(?:is\s+)?(?:insufficient|exhausted|depleted|empty|too low|used up)\b/i,
  /\b(?:credit|usage)\s+(?:limit|cap)\s+(?:reached|exceeded)\b/i,
];

/** Whether foreign response text specifically describes an exhausted quota. */
export function isQuotaFailureMessage(message: string): boolean {
  return QUOTA_FAILURE_PATTERNS.some((pattern) => pattern.test(message));
}

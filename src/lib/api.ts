export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  const text = await response.text();
  let data: { error?: unknown } = {};
  if (text) {
    try {
      data = JSON.parse(text) as { error?: unknown };
    } catch {
      if (!response.ok) {
        throw new ApiError(`Request failed (${response.status})`, response.status);
      }
      throw new ApiError("The server returned invalid JSON", response.status);
    }
  }

  if (!response.ok) {
    const message =
      typeof data.error === "string" && data.error
        ? data.error
        : `Request failed (${response.status})`;
    throw new ApiError(message, response.status);
  }

  return data as T;
}

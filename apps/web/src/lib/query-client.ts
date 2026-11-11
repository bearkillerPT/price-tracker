import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (failureCount, error) => !(error instanceof ApiRequestError && error.status < 500) && failureCount < 2,
    },
  },
});

export class ApiRequestError extends Error {
  readonly status: number;
  readonly details: unknown;

  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.details = details;
  }
}

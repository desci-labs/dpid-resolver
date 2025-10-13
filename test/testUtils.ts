// Simple interface for supertest response
export interface TestResponse {
    header: Record<string, string>;
    status: number;
    body: unknown;
    [key: string]: unknown;
}

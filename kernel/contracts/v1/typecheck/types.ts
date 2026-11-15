// Static proof that the generated types are exactly as strict as the contract. Each `@ts-expect-error`
// fails the compile if the type is looser than it should be, so this file passing means the inferred
// types reject what the contract rejects. Run with `npm run typecheck`.
import type { AuditVerifyResponse, InjectionRequest, JobRow, PutSecretResponse, SecretAddress, StatusResponse } from "../generated/schemas.ts";
import { operations } from "../generated/operations.ts";

const status: StatusResponse = { product: "Vaultix", version: "0.1.0", sealed: true, database: "ok" };
// @ts-expect-error "maybe" is not a database state
const wrongState: StatusResponse = { ...status, database: "maybe" };
// @ts-expect-error sealed is required
const missingSealed: StatusResponse = { product: "Vaultix", version: "0.1.0", database: "ok" };
// @ts-expect-error sealed is a boolean
const wrongType: StatusResponse = { ...status, sealed: "yes" };

const address: SecretAddress = { project: "payments", environment: "prod", name: "API_TOKEN" };
const withPath: SecretAddress = { ...address, path: "/app/" };
// @ts-expect-error name is required
const noName: SecretAddress = { project: "payments", environment: "prod" };

const job: JobRow = { id: "6f1c1f0e-8f1e-4e0b-9b5e-0c3f3a4b5c6d", kind: "sync", subject: "", status: "dead", attempts: 5, maxAttempts: 5, runAt: "2026-11-15T10:00:00Z", lastError: "503" };
// @ts-expect-error "stuck" is not a job status
const wrongJobStatus: JobRow = { ...job, status: "stuck" };
// @ts-expect-error attempts is a number
const wrongAttempts: JobRow = { ...job, attempts: "5" };

const put: PutSecretResponse = { outcome: "applied", name: "API_TOKEN", version: 1 };
// @ts-expect-error the only outcome of a write is "applied"
const wrongOutcome: PutSecretResponse = { ...put, outcome: "denied" };

const verify: AuditVerifyResponse = { chain: "payments", intact: false, firstAlteredEvent: 2 };
const injection: InjectionRequest = { purpose: "deploy", secrets: [address] };

// The operation map is typed too: an operation that does not exist is a compile error.
const method: "PUT" = operations.putSecret.method;
// @ts-expect-error there is no such operation
operations.deleteEverything;

export const used = [wrongState, missingSealed, wrongType, withPath, noName, wrongJobStatus, wrongAttempts, wrongOutcome, verify, injection, method];

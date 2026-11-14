import { Alert, AlertDescription, AlertTitle, Badge, Button } from "@app/components/v3";
import {
  TAiConnection,
  TAiConnectionTestRecord,
  useTestAiConnection
} from "@app/hooks/api/assistant";

import { NO_TOOL_CALLS } from "./connection-kinds";

export const TestOutcome = ({ record }: { record: TAiConnection["lastTest"] }) => {
  if (!record) return <Badge variant="neutral">Not Tested</Badge>;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <Badge variant={record.outcome === "passed" ? "success" : "danger"}>
          {record.outcome === "passed" ? "Test Passed" : "Test Failed"}
        </Badge>
        <span className="text-xs text-muted">{new Date(record.testedAt).toLocaleString()}</span>
      </div>
      <p
        className={`max-w-sm text-xs ${record.outcome === "failed" ? "text-danger" : "text-muted"}`}
      >
        {record.message}
      </p>
      {record.toolCalls === false && (
        <p className="max-w-sm text-xs text-warning">{NO_TOOL_CALLS}</p>
      )}
    </div>
  );
};

type Props = { connection: TAiConnection };

// Runs the test right after a save, so the person sees whether the connection answers.
export const ConnectionTestPanel = ({ connection }: Props) => {
  const test = useTestAiConnection();
  const result: (TAiConnectionTestRecord & { latencyMs?: number }) | undefined = test.data?.test;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        The test calls each model of {connection.name} and checks whether it can call tools.
      </p>
      <div>
        <Button
          variant="neutral"
          size="sm"
          isPending={test.isPending}
          onClick={() => test.mutate(connection.id)}
        >
          Test Now
        </Button>
      </div>
      {result && (
        <Alert variant={result.outcome === "passed" ? "success" : "danger"}>
          <AlertTitle>
            {result.outcome === "passed"
              ? `${connection.name} answered`
              : `${connection.name} did not answer`}
          </AlertTitle>
          <AlertDescription>
            <span>
              {result.message}
              {result.latencyMs !== undefined ? ` (${result.latencyMs} ms)` : ""}
            </span>
            {result.toolCalls === false && <span>{NO_TOOL_CALLS}</span>}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
};

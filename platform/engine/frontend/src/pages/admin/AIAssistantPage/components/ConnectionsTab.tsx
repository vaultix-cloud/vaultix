import { useState } from "react";

import { createNotification } from "@app/components/notifications";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@app/components/v3";
import {
  connectionDocument,
  TAiConnection,
  TAiConnectionKind,
  useDeleteAiConnection,
  useGetAiConnections,
  useTestAiConnection,
  useUpdateAiConnection
} from "@app/hooks/api/assistant";

import { CARD_KINDS, KIND_DETAILS, kindLabel, NO_TOOL_CALLS } from "./connection-kinds";
import { ConnectionSheet } from "./ConnectionSheet";
import { TestOutcome } from "./ConnectionTest";
import { HuggingFaceSheet } from "./HuggingFaceSheet";

const ConnectionRow = ({
  connection,
  onEdit,
  onRemove
}: {
  connection: TAiConnection;
  onEdit: () => void;
  onRemove: () => void;
}) => {
  const test = useTestAiConnection();
  const update = useUpdateAiConnection({ inline: false });

  const runTest = async () => {
    try {
      const { test: result } = await test.mutateAsync(connection.id);
      const tools = result.toolCalls === false ? ` ${NO_TOOL_CALLS}` : "";
      createNotification(
        result.outcome === "passed"
          ? {
              type: result.toolCalls === false ? "warning" : "success",
              title: `${connection.name} answered`,
              text: `${result.message} (${result.latencyMs} ms).${tools}`
            }
          : { type: "error", title: `${connection.name} did not answer`, text: result.message }
      );
    } catch {
      // The shared mutation handler reports why the test could not run.
    }
  };

  const use = () =>
    update.mutate(
      { id: connection.id, document: { ...connectionDocument(connection), active: true } },
      {
        onSuccess: () =>
          createNotification({
            type: "success",
            text: `The assistant now uses ${connection.name}.`
          })
      }
    );

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium">{connection.name}</span>
          <span className="text-xs text-muted">{kindLabel(connection.kind)}</span>
        </div>
      </TableCell>
      <TableCell className="font-mono text-xs">
        <div>{connection.models.standard}</div>
        {connection.models.fast && <div className="text-muted">fast: {connection.models.fast}</div>}
        {connection.models.deep && <div className="text-muted">deep: {connection.models.deep}</div>}
      </TableCell>
      <TableCell>
        {connection.active ? (
          <Badge variant="info">In Use</Badge>
        ) : (
          <Badge variant="neutral">Idle</Badge>
        )}
      </TableCell>
      <TableCell>
        <TestOutcome record={connection.lastTest} />
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="xs" variant="outline" isPending={test.isPending} onClick={runTest}>
            Test
          </Button>
          {!connection.active && (
            <Button size="xs" variant="outline" isPending={update.isPending} onClick={use}>
              Use
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          <Button size="xs" variant="ghost" onClick={onRemove}>
            Remove
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
};

type TSheetState =
  | { type: "closed" }
  | { type: "create"; kind: TAiConnectionKind }
  | { type: "huggingface" }
  | { type: "edit"; connection: TAiConnection };

export const ConnectionsTab = () => {
  const { data, isPending } = useGetAiConnections();
  const remove = useDeleteAiConnection();
  const [choosing, setChoosing] = useState(false);
  const [sheet, setSheet] = useState<TSheetState>({ type: "closed" });
  const [removing, setRemoving] = useState<TAiConnection>();
  const connections = data?.connections ?? [];
  const offered = CARD_KINDS.filter((kind) => !data?.kinds || data.kinds.includes(kind));
  const activeByDefault = !connections.some((connection) => connection.active);

  const choose = (kind: TAiConnectionKind) => {
    setChoosing(false);
    setSheet(kind === "huggingface" ? { type: "huggingface" } : { type: "create", kind });
  };
  const closeSheet = (open: boolean) => {
    if (!open) setSheet({ type: "closed" });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Connections</CardTitle>
        <CardDescription>
          The model providers the assistant can run on. One is in use at a time; a persona can name
          its own. Keys are encrypted with this instance&apos;s root key and never shown again.
        </CardDescription>
        <CardAction>
          <Button variant="neutral" onClick={() => setChoosing(true)}>
            Add Connection
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!isPending && connections.length === 0 ? (
          <Empty className="border">
            <EmptyHeader>
              <EmptyTitle>No connections yet</EmptyTitle>
              <EmptyDescription>
                Add a connection to turn the assistant on. Until one is in use, it stays off.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Connection</TableHead>
                <TableHead>Models</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Test</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {connections.map((connection) => (
                <ConnectionRow
                  key={connection.id}
                  connection={connection}
                  onEdit={() => setSheet({ type: "edit", connection })}
                  onRemove={() => setRemoving(connection)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={choosing} onOpenChange={setChoosing}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Connection</DialogTitle>
            <DialogDescription>Choose where the models run.</DialogDescription>
          </DialogHeader>
          <ul className="grid grid-cols-1 gap-3 pb-2 sm:grid-cols-2">
            {offered.map((kind) => (
              <li key={kind}>
                <button
                  type="button"
                  onClick={() => choose(kind)}
                  className="flex h-full w-full cursor-pointer flex-col items-start gap-1 rounded-md border border-border p-4 text-left transition-colors hover:bg-container-hover focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <span className="text-sm font-medium">{KIND_DETAILS[kind].label}</span>
                  <span className="text-xs text-muted">{KIND_DETAILS[kind].summary}</span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>

      {sheet.type === "create" && (
        <ConnectionSheet
          kind={sheet.kind}
          activeByDefault={activeByDefault}
          isOpen
          onOpenChange={closeSheet}
        />
      )}
      {sheet.type === "edit" && (
        <ConnectionSheet
          kind={sheet.connection.kind}
          connection={sheet.connection}
          activeByDefault={false}
          isOpen
          onOpenChange={closeSheet}
        />
      )}
      {sheet.type === "huggingface" && (
        <HuggingFaceSheet activeByDefault={activeByDefault} isOpen onOpenChange={closeSheet} />
      )}

      <AlertDialog
        open={Boolean(removing)}
        onOpenChange={(open) => !open && setRemoving(undefined)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removing?.name}</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the connection and its stored key. Personas that name it fall back to the
              connection in use.
              {removing?.active
                ? " It is in use, so the assistant turns off until another is."
                : ""}{" "}
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              isPending={remove.isPending}
              onClick={() => {
                if (!removing) return;
                const { id, name } = removing;
                remove.mutate(id, {
                  onSuccess: () =>
                    createNotification({ type: "success", text: `Removed ${name} and its key.` })
                });
              }}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

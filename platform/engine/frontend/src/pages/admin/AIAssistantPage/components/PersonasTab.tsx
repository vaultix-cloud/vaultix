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
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@app/components/v3";
import {
  personaDocument,
  TAiConnection,
  TAiPersona,
  useDeleteAiPersona,
  useGetAiConnections,
  useGetAiPersonas,
  useResetAiPersona,
  useUpdateAiPersona
} from "@app/hooks/api/assistant";

import { PersonaSheet } from "./PersonaSheet";

export const ROLE_LABEL = { router: "Router", specialist: "Specialist", guard: "Guard" } as const;

const PersonaRow = ({
  persona,
  connections,
  onEdit,
  onReset,
  onRemove
}: {
  persona: TAiPersona;
  connections: TAiConnection[];
  onEdit: () => void;
  onReset: () => void;
  onRemove: () => void;
}) => {
  const update = useUpdateAiPersona({ inline: false });
  const connection = connections.find((entry) => entry.id === persona.model.connectionId);

  return (
    <TableRow>
      <TableCell>
        <div className="flex flex-col">
          <span className="font-medium">
            {persona.name} <span className="font-mono text-xs text-muted">@{persona.slug}</span>
          </span>
          <span className="max-w-sm text-xs text-muted">{persona.description}</span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1">
          <Badge variant={persona.role === "guard" ? "warning" : "neutral"}>
            {ROLE_LABEL[persona.role]}
          </Badge>
          {persona.builtIn ? (
            persona.customized && <Badge variant="outline">Customized</Badge>
          ) : (
            <Badge variant="info">Custom</Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="text-xs">{persona.domains.join(", ")}</TableCell>
      <TableCell className="text-xs">
        {connection ? connection.name : "Connection in use"}
        <span className="text-muted"> · {persona.model.id ?? persona.model.tier}</span>
      </TableCell>
      <TableCell>
        <Switch
          aria-label={`${persona.name} enabled`}
          variant="neutral"
          checked={persona.enabled !== false}
          disabled={persona.role === "router" || update.isPending}
          onCheckedChange={(enabled) =>
            update.mutate(
              { slug: persona.slug, document: { ...personaDocument(persona), enabled } },
              {
                onSuccess: () =>
                  createNotification({
                    type: "success",
                    text: enabled
                      ? `${persona.name} is on.`
                      : `${persona.name} is off and will not answer.`
                  })
              }
            )
          }
        />
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-2">
          <Button size="xs" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
          {persona.builtIn && persona.customized && (
            <Button size="xs" variant="ghost" onClick={onReset}>
              Reset
            </Button>
          )}
          {!persona.builtIn && (
            <Button size="xs" variant="ghost" onClick={onRemove}>
              Remove
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
};

type TConfirm = { type: "reset" | "remove"; persona: TAiPersona };

export const PersonasTab = () => {
  const { data, isPending } = useGetAiPersonas();
  const { data: connectionData } = useGetAiConnections();
  const reset = useResetAiPersona();
  const remove = useDeleteAiPersona();
  const [editing, setEditing] = useState<TAiPersona>();
  const [isOpen, setIsOpen] = useState(false);
  const [confirm, setConfirm] = useState<TConfirm>();
  const personas = data?.personas ?? [];
  const connections = connectionData?.connections ?? [];
  const specialists = personas.filter((persona) => persona.role === "specialist");

  const runConfirm = () => {
    if (!confirm) return;
    const { type, persona } = confirm;
    if (type === "reset") {
      reset.mutate(persona.slug, {
        onSuccess: () =>
          createNotification({
            type: "success",
            text: `${persona.name} is back to the shipped default.`
          })
      });
    } else {
      remove.mutate(persona.slug, {
        onSuccess: () => createNotification({ type: "success", text: `Removed ${persona.name}.` })
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Personas</CardTitle>
        <CardDescription>
          Clyffy, the router, greets people and hands each question to the specialist for that area,
          by the page they are on or an @mention. The guard reviews proposed changes. Defaults ship
          with Vaultix and can be changed, turned off or reset here.
        </CardDescription>
        <CardAction>
          <Button
            variant="neutral"
            onClick={() => {
              setEditing(undefined);
              setIsOpen(true);
            }}
          >
            Add Persona
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {!isPending && (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Persona</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Areas</TableHead>
                  <TableHead>Runs On</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {personas.map((persona) => (
                  <PersonaRow
                    key={persona.slug}
                    persona={persona}
                    connections={connections}
                    onEdit={() => {
                      setEditing(persona);
                      setIsOpen(true);
                    }}
                    onReset={() => setConfirm({ type: "reset", persona })}
                    onRemove={() => setConfirm({ type: "remove", persona })}
                  />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
      {isOpen && (
        <PersonaSheet
          persona={editing}
          domains={data?.domains ?? []}
          specialists={specialists}
          connections={connections}
          isOpen
          onOpenChange={setIsOpen}
        />
      )}
      <AlertDialog open={Boolean(confirm)} onOpenChange={(open) => !open && setConfirm(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.type === "reset" ? "Reset" : "Remove"} {confirm?.persona.name}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm?.type === "reset"
                ? "Replaces every change made here with the shipped default. This cannot be undone."
                : "Removes this persona and the memories that applied only to it. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel variant="outline">Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="danger"
              isPending={reset.isPending || remove.isPending}
              onClick={runConfirm}
            >
              {confirm?.type === "reset" ? "Reset" : "Remove"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

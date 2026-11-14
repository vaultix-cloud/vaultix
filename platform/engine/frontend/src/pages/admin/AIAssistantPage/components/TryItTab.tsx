import { FormEvent, useState } from "react";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Detail,
  DetailGroup,
  DetailLabel,
  DetailValue,
  Field,
  FieldDescription,
  FieldLabel,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  TextArea
} from "@app/components/v3";
import {
  TAssistantReply,
  useGetAiPersonas,
  useSendAssistantMessage
} from "@app/hooks/api/assistant";

import { kindLabel } from "./connection-kinds";
import { ROLE_LABEL } from "./PersonasTab";

const AUTO = "__auto__";

const ROUTED_BY: Record<TAssistantReply["routedBy"], string> = {
  mention: "Asked for by name",
  page: "The page's area",
  router: "Chosen by the router",
  default: "The router, by default"
};

export const TryItTab = () => {
  const { data } = useGetAiPersonas();
  const send = useSendAssistantMessage();
  const [persona, setPersona] = useState(AUTO);
  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState("");
  const personas = (data?.personas ?? []).filter((entry) => entry.enabled !== false);
  const reply = send.data;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || send.isPending) return;
    setAsked(content);
    send.mutate({
      messages: [{ role: "user", content }],
      persona: persona === AUTO ? undefined : persona
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Try It</CardTitle>
        <CardDescription>
          Send one message as yourself and see who answered, on which model, and what it ran. Tools
          run with your own permissions, exactly as in the assistant panel.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor="ai-try-persona">Persona</FieldLabel>
            <Select value={persona} onValueChange={setPersona}>
              <SelectTrigger id="ai-try-persona" className="w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={AUTO}>Auto: let the router choose</SelectItem>
                {personas.map((entry) => (
                  <SelectItem key={entry.slug} value={entry.slug}>
                    {entry.name} ({ROLE_LABEL[entry.role]})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="ai-try-message">Message</FieldLabel>
            <TextArea
              id="ai-try-message"
              rows={4}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              aria-describedby="ai-try-message-help"
            />
            <FieldDescription id="ai-try-message-help">
              Never paste a secret value; the assistant works with names and references only.
            </FieldDescription>
          </Field>
          <div>
            <Button
              type="submit"
              variant="neutral"
              isPending={send.isPending}
              isDisabled={!draft.trim()}
            >
              Send
            </Button>
          </div>
        </form>

        <div aria-live="polite" className="flex flex-col gap-4">
          {reply && !send.isPending && (
            <section
              aria-label="Reply"
              className="flex flex-col gap-4 rounded-md border border-border p-4"
            >
              <DetailGroup className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Detail>
                  <DetailLabel>Answered by</DetailLabel>
                  <DetailValue>
                    {reply.persona.name}{" "}
                    <Badge variant="neutral">{ROLE_LABEL[reply.persona.role]}</Badge>
                  </DetailValue>
                </Detail>
                <Detail>
                  <DetailLabel>Routed by</DetailLabel>
                  <DetailValue>{ROUTED_BY[reply.routedBy] ?? reply.routedBy}</DetailValue>
                </Detail>
                <Detail>
                  <DetailLabel>Model</DetailLabel>
                  <DetailValue>
                    <span className="font-mono text-xs">{reply.provider.model}</span>
                    <span className="block text-xs text-muted">
                      {reply.provider.name} · {kindLabel(reply.provider.kind)}
                    </span>
                  </DetailValue>
                </Detail>
              </DetailGroup>
              <div>
                <h3 className="mb-1 text-xs text-muted">You asked</h3>
                <p className="text-sm whitespace-pre-wrap">{asked}</p>
              </div>
              <div>
                <h3 className="mb-1 text-xs text-muted">Answer</h3>
                <p className="text-sm whitespace-pre-wrap">{reply.message.content}</p>
              </div>
              <div>
                <h3 className="mb-1 text-xs text-muted">Actions</h3>
                {reply.actions.length === 0 ? (
                  <p className="text-sm">None.</p>
                ) : (
                  <ul className="flex flex-col gap-1 text-sm">
                    {reply.actions.map((action, index) => (
                      <li
                        // Actions have no identity of their own beyond their order in this answer.
                        // eslint-disable-next-line react/no-array-index-key
                        key={`${action.tool}-${index}`}
                        className="flex flex-wrap items-center gap-2"
                      >
                        <Badge variant={action.status === "ran" ? "success" : "danger"}>
                          {action.status === "ran" ? "Ran" : "Refused"}
                        </Badge>
                        <span className="font-mono text-xs">{action.tool}</span>
                        <span className="text-xs text-muted">{action.domain}</span>
                        {action.error && (
                          <span className="text-xs text-danger">{action.error}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {reply.proposals.length > 0 && (
                <div>
                  <h3 className="mb-1 text-xs text-muted">Suggested memories (not saved)</h3>
                  <ul className="list-disc pl-5 text-sm">
                    {reply.proposals.map((proposal) => (
                      <li key={proposal.content}>{proposal.content}</li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

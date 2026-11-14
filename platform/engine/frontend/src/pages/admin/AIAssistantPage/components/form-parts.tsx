import { ReactNode } from "react";
import { FieldErrors, FieldValues, get, Path, UseFormReturn } from "react-hook-form";

import {
  Alert,
  AlertDescription,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel
} from "@app/components/v3";
import { formPath, readServerRefusal } from "@app/hooks/api/assistant";

export type TControlProps = {
  id: string;
  "aria-invalid": boolean;
  "aria-describedby"?: string;
};

type FormFieldProps = {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  error?: string;
  children: (control: TControlProps) => ReactNode;
};

// Label, control, help and error, with the control described by whichever of the two is shown.
export const FormField = ({ id, label, description, error, children }: FormFieldProps) => {
  const describedBy = [description ? `${id}-help` : "", error ? `${id}-error` : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy || undefined
      })}
      {description && <FieldDescription id={`${id}-help`}>{description}</FieldDescription>}
      <FieldError id={`${id}-error`}>{error}</FieldError>
    </Field>
  );
};

export const errorAt = (errors: FieldErrors, path: string): string | undefined => {
  const entry = get(errors, path);
  return typeof entry?.message === "string" && entry.message ? entry.message : undefined;
};

// Puts each field the server named beside its input and returns what has no input to sit by.
// mapPath translates a document path into the form's own path when the two differ.
export const applyRefusal = <T extends FieldValues>(
  error: unknown,
  form: UseFormReturn<T>,
  mapPath: (path: string) => string | undefined = (path) => path
): string | undefined => {
  const refusal = readServerRefusal(error);
  if (!refusal) return undefined;
  const unplaced: string[] = [];
  refusal.fields.forEach(({ path, message }) => {
    let target = mapPath(formPath(path));
    let value = target ? form.getValues(target as Path<T>) : undefined;
    if (target && value && typeof value === "object" && "value" in value) {
      target = `${target}.value`;
      value = form.getValues(target as Path<T>);
    }
    if (target && value !== undefined) {
      form.setError(target as Path<T>, { type: "server", message });
    } else {
      unplaced.push(message);
    }
  });
  if (refusal.fields.length > 0 && unplaced.length === 0) return undefined;
  return [refusal.message, ...unplaced.filter((message) => message !== refusal.message)].join(" ");
};

export const RefusalAlert = ({ message }: { message?: string }) =>
  message ? (
    <Alert variant="danger">
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  ) : null;

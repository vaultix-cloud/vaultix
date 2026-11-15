import { ChangeEvent, ReactNode, useId, useState } from "react";

import { Fieldset } from "../Fieldset/Fieldset";

import "./Choice.css";

export type TRadioOption = {
  value: string;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export type TRadioGroupProps = {
  legend: ReactNode;
  options: TRadioOption[];
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  name?: string;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  disabled?: boolean;
  orientation?: "vertical" | "horizontal";
  className?: string;
};

// Native radios in a fieldset. The browser provides the keyboard model: Tab enters the group at
// the checked radio, arrow keys move and check, and the group is one Tab stop.
export const RadioGroup = ({
  legend,
  options,
  value,
  defaultValue,
  onValueChange,
  name,
  help,
  error,
  required,
  disabled,
  orientation,
  className
}: TRadioGroupProps) => {
  const generated = useId();
  const groupName = name ?? `vx-radio-${generated}`;
  const [uncontrolled, setUncontrolled] = useState(defaultValue);
  const checked = value ?? uncontrolled;

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (value === undefined) setUncontrolled(event.target.value);
    onValueChange?.(event.target.value);
  };

  return (
    <Fieldset
      role="radiogroup"
      required={required}
      legend={legend}
      help={help}
      error={error}
      disabled={disabled}
      orientation={orientation}
      className={className}
    >
      {options.map((option) => {
        const inputId = `${groupName}-${option.value}`;
        const labelId = `${inputId}-label`;
        const descriptionId = option.description ? `${inputId}-description` : undefined;
        return (
          <label key={option.value} className="vx-choice" htmlFor={inputId}>
            <span className="vx-choice__control">
              <input
                id={inputId}
                type="radio"
                className="vx-radio"
                name={groupName}
                value={option.value}
                checked={checked === option.value}
                disabled={option.disabled}
                required={required}
                aria-labelledby={labelId}
                aria-describedby={descriptionId}
                onChange={onChange}
              />
            </span>
            <span className="vx-choice__text">
              <span id={labelId} className="vx-choice__label">
                {option.label}
              </span>
              {option.description && (
                <span id={descriptionId} className="vx-choice__description">
                  {option.description}
                </span>
              )}
            </span>
          </label>
        );
      })}
    </Fieldset>
  );
};

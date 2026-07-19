import { Text, useInput } from "ink";
import { useState } from "react";
import { useTheme } from "../theme";

export function TextInput({
  value,
  onChange,
  onSubmit,
  placeholder,
  width,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  placeholder: string;
  width: number;
}) {
  const theme = useTheme();
  const [cursorState, setCursorState] = useState(value.length);
  const cursor = Math.min(cursorState, value.length);

  useInput((input, key) => {
    if (key.return) return onSubmit(value);
    if (key.leftArrow) return setCursorState(Math.max(0, cursor - 1));
    if (key.rightArrow) return setCursorState(Math.min(value.length, cursor + 1));
    if (key.home || (key.ctrl && input === "a")) return setCursorState(0);
    if (key.end || (key.ctrl && input === "e")) return setCursorState(value.length);
    if (key.backspace || key.delete) {
      if (cursor === 0) return;
      const next = value.slice(0, cursor - 1) + value.slice(cursor);
      setCursorState(cursor - 1);
      onChange(next);
      return;
    }
    if (key.ctrl || key.meta || !input) return;
    const clean = [...input]
      .filter((character) => character > " " && character !== "\u007f")
      .join("");
    if (!clean) return;
    const next = value.slice(0, cursor) + clean + value.slice(cursor);
    setCursorState(cursor + clean.length);
    onChange(next);
  });

  const span = Math.max(8, width);
  const offset = Math.max(0, cursor - span + 1);
  if (!value) {
    return (
      <Text>
        <Text inverse> </Text>
        <Text color={theme.gray} dimColor={theme.dimSecondary}>
          {placeholder.slice(0, span - 1)}
        </Text>
      </Text>
    );
  }

  return (
    <Text>
      {Array.from({ length: Math.min(span, value.length - offset + 1) }, (_, column) => {
        const index = offset + column;
        return (
          <Text key={index} color={theme.primary} inverse={index === cursor}>
            {value[index] ?? " "}
          </Text>
        );
      })}
    </Text>
  );
}

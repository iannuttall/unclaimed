import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { useTheme } from "../theme";

const frameButtonWidth = (label: string) => label.length + 4;

export function FramedInput({
  title,
  width,
  button,
  buttonDim = false,
  children,
}: {
  title: string;
  width: number;
  button?: string;
  buttonDim?: boolean;
  children: ReactNode;
}) {
  const theme = useTheme();
  const inner = width - 2;
  const tail = Math.max(0, inner - title.length - 3);
  const buttonWidth = button ? frameButtonWidth(button) : 0;
  const fillColor = buttonDim ? theme.gray : theme.primary;

  return (
    <Box width={width + buttonWidth}>
      <Box flexDirection="column" width={width}>
        <Text>
          <Text color={theme.gray} dimColor={theme.dimSecondary}>
            ╭─{" "}
          </Text>
          <Text color={theme.primary}>{title}</Text>
          <Text color={theme.gray} dimColor={theme.dimSecondary}>
            {` ${"─".repeat(tail)}${button ? "─" : "╮"}`}
          </Text>
        </Text>
        <Box width={width} height={1} overflow="hidden">
          <Text color={theme.gray} dimColor={theme.dimSecondary}>
            │{" "}
          </Text>
          <Text color={theme.primary}>❯ </Text>
          <Box flexGrow={1} height={1} overflow="hidden">
            {children}
          </Box>
          {button ? null : (
            <Text color={theme.gray} dimColor={theme.dimSecondary}>
              {" "}
              │
            </Text>
          )}
        </Box>
        <Text color={theme.gray} dimColor={theme.dimSecondary}>
          {`╰${"─".repeat(inner)}${button ? "─" : "╯"}`}
        </Text>
      </Box>
      {button ? (
        <Box flexDirection="column" width={buttonWidth}>
          <Text bold color={fillColor} dimColor={buttonDim && theme.dimSecondary}>
            {"▄".repeat(buttonWidth)}
          </Text>
          <Text
            backgroundColor={theme.inverseButton ? undefined : fillColor}
            color={theme.inverseButton ? undefined : theme.dark}
            inverse={theme.inverseButton && !buttonDim}
            dimColor={buttonDim && theme.dimSecondary}
            bold
          >
            {`  ${button}  `}
          </Text>
          <Text bold color={fillColor} dimColor={buttonDim && theme.dimSecondary}>
            {"▀".repeat(buttonWidth)}
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

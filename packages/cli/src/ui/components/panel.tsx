import { Box, Text } from "ink";
import type { ReactNode } from "react";
import { useTheme } from "../theme";

export function Panel({
  title,
  width,
  bodyHeight,
  children,
}: {
  title: string;
  width: number;
  bodyHeight?: number;
  children: ReactNode;
}) {
  const theme = useTheme();
  const inner = width - 2;
  const tail = Math.max(0, inner - title.length - 3);
  return (
    <Box flexDirection="column" width={width}>
      <Text>
        <Text color={theme.gray} dimColor={theme.dimSecondary}>
          ╭─{" "}
        </Text>
        <Text color={theme.primary}>{title}</Text>
        <Text color={theme.gray} dimColor={theme.dimSecondary}>
          {` ${"─".repeat(tail)}╮`}
        </Text>
      </Text>
      <Box
        width={width}
        borderStyle="round"
        borderColor={theme.gray}
        borderDimColor={theme.dimSecondary}
        borderBackgroundColor={theme.background}
        borderTop={false}
        flexDirection="column"
        paddingX={2}
        minHeight={bodyHeight === undefined ? undefined : bodyHeight + 1}
      >
        {children}
      </Box>
    </Box>
  );
}

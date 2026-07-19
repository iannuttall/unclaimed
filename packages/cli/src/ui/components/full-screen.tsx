import { Box, useStdout } from "ink";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { useTheme } from "../theme";

export function FullScreen({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const { stdout } = useStdout();
  const dimensions = useCallback(
    () => ({
      columns: stdout?.columns && stdout.columns > 0 ? stdout.columns : 80,
      rows: stdout?.rows && stdout.rows > 1 ? stdout.rows : 24,
    }),
    [stdout],
  );
  const [size, setSize] = useState(dimensions);

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setSize(dimensions());
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout, dimensions]);

  return (
    <Box
      width={size.columns}
      height={size.rows - 1}
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      backgroundColor={theme.background}
    >
      <Box flexDirection="column" alignItems="center" flexShrink={0}>
        {children}
      </Box>
    </Box>
  );
}

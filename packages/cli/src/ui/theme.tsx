import { createContext, type ReactNode, useContext } from "react";

export const THEME_MODES = ["auto", "light", "dark"] as const;
export type ThemeMode = (typeof THEME_MODES)[number];

export interface Theme {
  mode: ThemeMode;
  primary?: string;
  gray?: string;
  dark?: string;
  background?: string;
  dimSecondary: boolean;
  inverseButton: boolean;
}

const themes: Record<ThemeMode, Theme> = {
  auto: {
    mode: "auto",
    dimSecondary: true,
    inverseButton: true,
  },
  light: {
    mode: "light",
    primary: "#18181b",
    gray: "#52525b",
    dark: "#ffffff",
    background: "#ffffff",
    dimSecondary: false,
    inverseButton: false,
  },
  dark: {
    mode: "dark",
    primary: "#ffffff",
    gray: "#a1a1aa",
    dark: "#18181b",
    background: "#18181b",
    dimSecondary: false,
    inverseButton: false,
  },
};

const ThemeContext = createContext<Theme>(themes.auto);

export function ThemeProvider({ mode, children }: { mode: ThemeMode; children: ReactNode }) {
  return <ThemeContext.Provider value={themes[mode]}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return THEME_MODES[(THEME_MODES.indexOf(mode) + 1) % THEME_MODES.length];
}

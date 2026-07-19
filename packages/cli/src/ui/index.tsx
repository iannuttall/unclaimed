import { render } from "ink";
import { openStore } from "../open-store";
import { App } from "./app";

const enterAltScreen = () => process.stdout.write("\u001b[?1049h\u001b[H");
const leaveAltScreen = () => process.stdout.write("\u001b[?1049l");

export async function runInteractive(tlds: string[], database: string): Promise<void> {
  const store = await openStore(database);
  const browseTlds = [...new Set([...tlds, ...store.trackedTlds()])];
  enterAltScreen();
  process.on("exit", leaveAltScreen);
  try {
    const { waitUntilExit } = render(<App tlds={tlds} browseTlds={browseTlds} store={store} />);
    await waitUntilExit();
  } finally {
    process.off("exit", leaveAltScreen);
    leaveAltScreen();
    store.close();
  }
}

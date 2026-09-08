import { patchConsole, patchFetch } from "@codeflow/instrumentation";
import { patchFileSystem } from "./fs.js";
import { patchFrameworks, type FrameworkInstrumentationOptions } from "./frameworks.js";
import { patchNodeHttp } from "./http.js";

export interface NodeInstrumentationOptions {
  projectRoot?: string;
  console?: boolean;
  fetch?: boolean;
  http?: boolean;
  fileSystem?: boolean;
  frameworks?: false | FrameworkInstrumentationOptions;
}

export function installNodeInstrumentation(options: NodeInstrumentationOptions = {}): () => void {
  const restores: Array<() => void> = [];
  if (options.fetch !== false) {
    restores.push(patchFetch());
  }
  if (options.http !== false) {
    restores.push(patchNodeHttp());
  }
  if (options.console !== false) {
    restores.push(patchConsole());
  }
  if (options.fileSystem !== false) {
    restores.push(patchFileSystem(options.projectRoot));
  }
  if (options.frameworks !== false) {
    restores.push(patchFrameworks(typeof options.frameworks === "object" ? options.frameworks : undefined));
  }

  return () => {
    for (const restore of restores.reverse()) {
      restore();
    }
  };
}

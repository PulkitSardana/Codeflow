import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { originalPositionFor, sourceContentFor, TraceMap } from "@jridgewell/trace-mapping";
import type { SourceMapInput } from "@jridgewell/trace-mapping";
import type { SourceLocation } from "@codeflow/session";

export interface SourceMapResolveOptions {
  projectRoot?: string;
}

interface LoadedMap {
  map: TraceMap;
  raw: SourceMapInput & { sources?: string[]; sourcesContent?: Array<string | null>; sourceRoot?: string };
  mapFile?: string;
  generatedFile: string;
}

const sourceMapCache = new Map<string, LoadedMap | null>();

export function mapSourceLocation(source: SourceLocation | undefined, options: SourceMapResolveOptions = {}): SourceLocation | undefined {
  if (!source?.file || !source.line || source.column === undefined) {
    return source;
  }

  if (!isGeneratedJavaScript(source.file)) {
    return source;
  }

  const loaded = loadSourceMap(source.file);
  if (!loaded) {
    return source;
  }

  const mapped = originalPositionFor(loaded.map, {
    line: source.line,
    column: Math.max(0, source.column - 1)
  });

  if (!mapped.source || !mapped.line || mapped.column === null) {
    return source;
  }

  const projectRoot = options.projectRoot ?? process.env.CODEFLOW_PROJECT_ROOT ?? process.cwd();
  const originalFile = resolveOriginalSourcePath(mapped.source, loaded, projectRoot);

  return {
    ...source,
    file: originalFile,
    line: mapped.line,
    column: mapped.column + 1,
    functionName: mapped.name ?? source.functionName,
    mapped: true,
    original: {
      file: source.file,
      line: source.line,
      column: source.column
    }
  };
}

export function sourceContentFromMap(source: SourceLocation | undefined, options: SourceMapResolveOptions = {}): { path: string; content: string } | undefined {
  if (!source?.file || !source.original?.file) {
    return undefined;
  }

  if (fs.existsSync(source.file)) {
    try {
      return { path: source.file, content: fs.readFileSync(source.file, "utf8") };
    } catch {
      // Continue to sourcesContent lookup below.
    }
  }

  const loaded = loadSourceMap(source.original.file);
  if (!loaded) {
    return undefined;
  }

  const projectRoot = options.projectRoot ?? process.env.CODEFLOW_PROJECT_ROOT ?? process.cwd();
  for (const mapSource of loaded.map.sources) {
    if (!mapSource) {
      continue;
    }
    const resolved = resolveOriginalSourcePath(mapSource, loaded, projectRoot);
    if (samePath(resolved, source.file)) {
      const content = sourceContentFor(loaded.map, mapSource);
      if (typeof content === "string") {
        return { path: resolved, content };
      }
    }
  }

  return undefined;
}

export function clearSourceMapCache(): void {
  sourceMapCache.clear();
}

function loadSourceMap(file: string): LoadedMap | undefined {
  const generatedFile = normalizeGeneratedPath(file);
  if (!generatedFile || !fs.existsSync(generatedFile)) {
    return undefined;
  }

  if (sourceMapCache.has(generatedFile)) {
    return sourceMapCache.get(generatedFile) ?? undefined;
  }

  try {
    const generatedContent = fs.readFileSync(generatedFile, "utf8");
    const sourceMappingUrl = findSourceMappingUrl(generatedContent);
    if (!sourceMappingUrl) {
      sourceMapCache.set(generatedFile, null);
      return undefined;
    }

    const loadedMap = loadMapFromUrl(sourceMappingUrl, generatedFile);
    if (!loadedMap) {
      sourceMapCache.set(generatedFile, null);
      return undefined;
    }

    sourceMapCache.set(generatedFile, loadedMap);
    return loadedMap;
  } catch {
    sourceMapCache.set(generatedFile, null);
    return undefined;
  }
}

function findSourceMappingUrl(content: string): string | undefined {
  const matches = [...content.matchAll(/\/\/[#@]\s*sourceMappingURL=(\S+)\s*$/gm)];
  return matches.at(-1)?.[1];
}

function loadMapFromUrl(sourceMappingUrl: string, generatedFile: string): LoadedMap | undefined {
  if (/^https?:\/\//i.test(sourceMappingUrl)) {
    return undefined;
  }

  if (sourceMappingUrl.startsWith("data:")) {
    const raw = parseInlineMap(sourceMappingUrl);
    if (!raw) {
      return undefined;
    }
    return {
      raw,
      map: new TraceMap(raw, pathToFileURL(generatedFile).href),
      generatedFile
    };
  }

  const mapFile = path.resolve(path.dirname(generatedFile), decodeURIComponent(sourceMappingUrl));
  const raw = JSON.parse(fs.readFileSync(mapFile, "utf8")) as SourceMapInput & {
    sources?: string[];
    sourcesContent?: Array<string | null>;
    sourceRoot?: string;
  };

  return {
    raw,
    map: new TraceMap(raw, pathToFileURL(mapFile).href),
    mapFile,
    generatedFile
  };
}

function parseInlineMap(sourceMappingUrl: string): (SourceMapInput & { sources?: string[]; sourcesContent?: Array<string | null>; sourceRoot?: string }) | undefined {
  const match = /^data:application\/json(?:;charset=[^;,]+)?(;base64)?,(.*)$/i.exec(sourceMappingUrl);
  if (!match) {
    return undefined;
  }

  const encoded = match[2];
  const json = match[1]
    ? Buffer.from(encoded, "base64").toString("utf8")
    : decodeURIComponent(encoded);
  return JSON.parse(json) as SourceMapInput & { sources?: string[]; sourcesContent?: Array<string | null>; sourceRoot?: string };
}

function resolveOriginalSourcePath(source: string, loaded: LoadedMap, projectRoot: string): string {
  const sanitized = sanitizeMapSource(source);
  if (path.isAbsolute(sanitized)) {
    return path.normalize(sanitized);
  }

  const sourceRoot = loaded.raw.sourceRoot ? sanitizeMapSource(loaded.raw.sourceRoot) : "";
  const fromRoot = sourceRoot && !/^[a-z][a-z\d+\-.]*:\/\//i.test(sourceRoot)
    ? path.resolve(projectRoot, sourceRoot, sanitized)
    : undefined;
  if (fromRoot && fs.existsSync(fromRoot)) {
    return fromRoot;
  }

  const mapDir = loaded.mapFile ? path.dirname(loaded.mapFile) : path.dirname(loaded.generatedFile);
  const fromMap = path.resolve(mapDir, sourceRoot, sanitized);
  if (fs.existsSync(fromMap)) {
    return fromMap;
  }

  return path.resolve(projectRoot, sanitized);
}

function sanitizeMapSource(source: string): string {
  if (source.startsWith("file://")) {
    try {
      return fileURLToPath(source);
    } catch {
      return source;
    }
  }

  return source
    .replace(/^webpack:\/+/, "")
    .replace(/^vite:\/+/, "")
    .replace(/^rollup:\/+/, "")
    .replace(/^\/__vite\//, "")
    .replace(/^\.\//, "");
}

function normalizeGeneratedPath(file: string): string | undefined {
  if (file.startsWith("file://")) {
    try {
      return fileURLToPath(file);
    } catch {
      return undefined;
    }
  }
  if (file.startsWith("node:")) {
    return undefined;
  }
  return path.resolve(file);
}

function isGeneratedJavaScript(file: string): boolean {
  return /\.(?:mjs|cjs|js|jsx)$/i.test(file);
}

function samePath(left: string, right: string): boolean {
  return path.resolve(left) === path.resolve(right);
}

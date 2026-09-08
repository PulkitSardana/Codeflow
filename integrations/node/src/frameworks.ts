import { register as registerAsyncLoader } from "node:module";
import { trace } from "@codeflow/core";
import { captureSourceLocation } from "@codeflow/parser";
import type { SourceLocation } from "@codeflow/session";
import { Hook as ImportHook } from "import-in-the-middle";
import { register as registerSyncLoader, supportsSyncHooks } from "import-in-the-middle/register-hooks.mjs";
import { Hook as RequireHook } from "require-in-the-middle";

type Handler = (...args: unknown[]) => unknown;
type FrameworkName = "express" | "fastify";

const PATCH_KEY = "__CODEFLOW_FRAMEWORK_PATCHED__";
const WRAPPED = Symbol.for("codeflow.framework.wrapped");
const PATCHED_APP = Symbol.for("codeflow.framework.app.patched");

const EXPRESS_METHODS = ["all", "delete", "get", "head", "options", "patch", "post", "put", "use"] as const;
const FASTIFY_METHODS = ["all", "delete", "get", "head", "options", "patch", "post", "put"] as const;

export interface FrameworkInstrumentationOptions {
  express?: boolean;
  fastify?: boolean;
}

export function patchFrameworks(options: FrameworkInstrumentationOptions = {}): () => void {
  const registry = globalThis as unknown as Record<string, unknown>;
  if (registry[PATCH_KEY]) {
    return () => undefined;
  }

  registry[PATCH_KEY] = true;
  registerImportLoader();

  const modules = frameworkNames.filter((name) => options[name] !== false);
  const requireHook = new RequireHook(modules, (exported, name) => wrapFrameworkExport(exported, name) as typeof exported);
  const importHook = new ImportHook(modules, (exported, name) => {
    if (name === "express" && options.express !== false) {
      const wrapped = wrapExpressExport(exported.default ?? exported);
      exported.default = wrapped;
      return wrapped;
    }
    if (name === "fastify" && options.fastify !== false) {
      const wrapped = wrapFastifyExport(exported.default ?? exported.fastify ?? exported);
      exported.default = wrapped;
      exported.fastify = wrapped;
      return wrapped;
    }
    return exported.default;
  });

  return () => {
    requireHook.unhook();
    importHook.unhook();
    registry[PATCH_KEY] = false;
  };
}

function registerImportLoader(): void {
  const registry = globalThis as unknown as Record<string, unknown>;
  if (registry.__CODEFLOW_IMPORT_LOADER_REGISTERED__) {
    return;
  }

  if (supportsSyncHooks()) {
    registerSyncLoader({ include: [...frameworkNames] });
  } else {
    registerAsyncLoader("import-in-the-middle/hook.mjs", import.meta.url, {
      data: { include: [...frameworkNames] }
    });
  }
  registry.__CODEFLOW_IMPORT_LOADER_REGISTERED__ = true;
}

function wrapFrameworkExport(exported: unknown, name: string): unknown {
  if (name === "express") {
    return wrapExpressExport(exported);
  }
  if (name === "fastify") {
    return wrapFastifyExport(exported);
  }
  return exported;
}

function wrapExpressExport(exported: unknown): unknown {
  if (typeof exported !== "function" || isWrapped(exported)) {
    return exported;
  }

  const originalExpress = exported as Handler & Record<PropertyKey, unknown>;
  const wrappedExpress = function codeflowExpress(this: unknown, ...args: unknown[]) {
    const app = originalExpress.apply(this, args);
    patchExpressRouter(app, "app");
    return app;
  } as Handler & Record<PropertyKey, unknown>;

  copyStatics(originalExpress, wrappedExpress);
  wrappedExpress.Router = function codeflowExpressRouter(this: unknown, ...args: unknown[]) {
    const routerFactory = originalExpress.Router as Handler;
    const router = routerFactory.apply(this, args);
    patchExpressRouter(router, "router");
    return router;
  };
  markWrapped(wrappedExpress);
  return wrappedExpress;
}

function patchExpressRouter(router: unknown, kind: "app" | "router"): void {
  if (!isObject(router) || router[PATCHED_APP]) {
    return;
  }

  router[PATCHED_APP] = true;
  for (const method of EXPRESS_METHODS) {
    const original = router[method];
    if (typeof original !== "function") {
      continue;
    }

    router[method] = function codeflowExpressRoute(this: unknown, ...args: unknown[]) {
      const source = captureSourceLocation();
      const routePath = expressRoutePath(args);
      const wrappedArgs = args.map((arg) => wrapExpressArgument(arg, {
        method: method.toUpperCase(),
        routePath,
        kind,
        source
      }));
      return original.apply(this, wrappedArgs);
    };
  }

  const originalRoute = router.route;
  if (typeof originalRoute === "function") {
    router.route = function codeflowExpressRouteBuilder(this: unknown, pathArg: unknown) {
      const source = captureSourceLocation();
      const route = originalRoute.apply(this, [pathArg]);
      patchExpressRouter(route, "router");
      if (isObject(route)) {
        route.__codeflowRoutePath = pathToLabel(pathArg);
        route.__codeflowRouteSource = source;
      }
      return route;
    };
  }
}

function wrapExpressArgument(arg: unknown, context: { method: string; routePath: string; kind: string; source?: SourceLocation }): unknown {
  if (Array.isArray(arg)) {
    return arg.map((entry) => wrapExpressArgument(entry, context));
  }
  if (typeof arg !== "function" || isWrapped(arg)) {
    return arg;
  }
  if (arg.length === 4) {
    return arg;
  }

  const original = arg as Handler;
  const label = `${context.method === "USE" ? "Express middleware" : "Express"} ${context.method} ${context.routePath}`;
  const wrapped = function codeflowExpressHandler(this: unknown, req: unknown, res: unknown, next: unknown) {
    return trace(label, () => original.call(this, req, res, next), {
      source: context.source,
      metadata: {
        framework: "express",
        router: context.kind,
        method: context.method,
        route: context.routePath
      }
    });
  };
  markWrapped(wrapped);
  return wrapped;
}

function wrapFastifyExport(exported: unknown): unknown {
  const factory = typeof exported === "function"
    ? exported
    : isObject(exported) && typeof exported.fastify === "function"
      ? exported.fastify
      : undefined;

  if (!factory || isWrapped(factory)) {
    return exported;
  }

  const originalFactory = factory as Handler & Record<PropertyKey, unknown>;
  const wrappedFactory = function codeflowFastify(this: unknown, ...args: unknown[]) {
    const app = originalFactory.apply(this, args);
    patchFastifyInstance(app);
    return app;
  } as Handler & Record<PropertyKey, unknown>;
  copyStatics(originalFactory, wrappedFactory);
  markWrapped(wrappedFactory);

  if (typeof exported === "function") {
    return wrappedFactory;
  }

  if (isObject(exported)) {
    return {
      ...exported,
      fastify: wrappedFactory,
      default: wrappedFactory
    };
  }

  return exported;
}

function patchFastifyInstance(instance: unknown): void {
  if (!isObject(instance) || instance[PATCHED_APP]) {
    return;
  }

  instance[PATCHED_APP] = true;
  for (const method of FASTIFY_METHODS) {
    const original = instance[method];
    if (typeof original !== "function") {
      continue;
    }

    instance[method] = function codeflowFastifyRoute(this: unknown, ...args: unknown[]) {
      const source = captureSourceLocation();
      const routePath = pathToLabel(args[0]);
      const wrappedArgs = wrapFastifyShorthandArgs(args, method.toUpperCase(), routePath, source);
      return original.apply(this, wrappedArgs);
    };
  }

  const originalRoute = instance.route;
  if (typeof originalRoute === "function") {
    instance.route = function codeflowFastifyRouteObject(this: unknown, routeOptions: unknown) {
      const source = captureSourceLocation();
      const wrapped = wrapFastifyRouteOptions(routeOptions, source);
      return originalRoute.apply(this, [wrapped]);
    };
  }
}

function wrapFastifyShorthandArgs(args: unknown[], method: string, routePath: string, source?: SourceLocation): unknown[] {
  const next = [...args];
  for (let index = next.length - 1; index >= 0; index -= 1) {
    const value = next[index];
    if (typeof value === "function") {
      next[index] = wrapFastifyHandler(value, method, routePath, source);
      return next;
    }
    if (isObject(value) && typeof value.handler === "function") {
      next[index] = {
        ...value,
        handler: wrapFastifyHandler(value.handler, method, routePath, source)
      };
      return next;
    }
  }
  return next;
}

function wrapFastifyRouteOptions(routeOptions: unknown, source?: SourceLocation): unknown {
  if (!isObject(routeOptions)) {
    return routeOptions;
  }
  const method = Array.isArray(routeOptions.method) ? routeOptions.method.join(",") : String(routeOptions.method ?? "ROUTE").toUpperCase();
  const routePath = pathToLabel(routeOptions.url ?? routeOptions.path);
  return {
    ...routeOptions,
    handler: typeof routeOptions.handler === "function"
      ? wrapFastifyHandler(routeOptions.handler, method, routePath, source)
      : routeOptions.handler
  };
}

function wrapFastifyHandler(handler: unknown, method: string, routePath: string, source?: SourceLocation): unknown {
  if (typeof handler !== "function" || isWrapped(handler)) {
    return handler;
  }

  const original = handler as Handler;
  const wrapped = function codeflowFastifyHandler(this: unknown, request: unknown, reply: unknown) {
    return trace(`Fastify ${method} ${routePath}`, () => original.call(this, request, reply), {
      source,
      metadata: {
        framework: "fastify",
        method,
        route: routePath
      }
    });
  };
  markWrapped(wrapped);
  return wrapped;
}

function expressRoutePath(args: unknown[]): string {
  const first = args[0];
  if (typeof first === "function" || Array.isArray(first) && first.every((entry) => typeof entry === "function")) {
    return "/";
  }
  return pathToLabel(first);
}

function pathToLabel(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof RegExp) {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(pathToLabel).join(",");
  }
  return "/";
}

function copyStatics(source: Record<PropertyKey, unknown>, target: Record<PropertyKey, unknown>): void {
  for (const key of Reflect.ownKeys(source)) {
    if (key === "length" || key === "name" || key === "prototype") {
      continue;
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, key);
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
    }
  }
  Object.setPrototypeOf(target, Object.getPrototypeOf(source));
}

function markWrapped(fn: Handler): void {
  (fn as Handler & Record<PropertyKey, unknown>)[WRAPPED] = true;
}

function isWrapped(value: unknown): boolean {
  return isObject(value) && Boolean(value[WRAPPED]);
}

function isObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null || typeof value === "function";
}

export const frameworkNames: FrameworkName[] = ["express", "fastify"];

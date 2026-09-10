/**
 * A stand-in for `@figma/code-connect`'s `figma` object, so the `*.figma.tsx` files in this app
 * are real, typechecked modules before the Figma file they point at exists.
 *
 * Why a stand-in rather than the package: `@figma/code-connect` pulls `ts-morph`, its own pinned
 * `typescript`, `esbuild-wasm`, `jsdom`, `prettier` and `undici` — a second toolchain in the
 * lockfile, installed on every CI run, for files that nothing in the build imports. The operator
 * installs it once, with `npx`, at the moment they publish (see `apps/web/CODE_CONNECT.md`).
 *
 * The API mirrors the real one exactly, so switching is one line per file:
 *
 * ```diff
 * -import figma from "../../lib/code-connect.js";
 * +import figma from "@figma/code-connect";
 * ```
 *
 * At runtime each helper returns a placeholder of the type the real one is declared to return.
 * That is what lets `apps/web/test/code-connect.test.ts` call every `example` and check it builds
 * an element — the schema check that stands in for `figma connect` until the CLI can run.
 */
import type { ReactNode } from "react";

/** The prop map a connection declares: Figma property name → the value the example receives. */
export type PropMap = Record<string, unknown>;

/** One registered `figma.connect` call. */
export interface Connection<P extends PropMap = PropMap> {
  /** The React component the Figma node maps to, or `undefined` for an example-only connection. */
  component: unknown;
  /** The Figma node URL: `https://www.figma.com/design/<FILE_KEY>?node-id=<NODE_ID>`. */
  url: string;
  props: P;
  example: (props: P) => ReactNode;
}

/**
 * Every connection declared by an imported `*.figma.tsx`. The real Code Connect CLI discovers
 * files by glob; here the import itself is the registration.
 */
export const connections: Connection[] = [];

interface Config<P extends PropMap> {
  props: P;
  example: (props: P) => ReactNode;
}

function connect<P extends PropMap>(component: unknown, url: string, config: Config<P>): void;
function connect<P extends PropMap>(url: string, config: Config<P>): void;
function connect<P extends PropMap>(
  first: unknown,
  second: string | Config<P>,
  third?: Config<P>,
): void {
  const url = typeof second === "string" ? second : (first as string);
  const config = typeof second === "string" ? third : second;
  const component = typeof second === "string" ? first : undefined;
  if (config === undefined) throw new Error(`figma.connect(${url}): no config`);
  connections.push({
    component,
    url,
    props: config.props,
    example: config.example as (props: PropMap) => ReactNode,
  });
}

const figma = {
  connect,

  /** A Figma text or string-variant property, read as a string. */
  string(figmaName: string): string {
    return `{${figmaName}}`;
  },

  /** A Figma variant property, mapped onto the code values it corresponds to. */
  enum<V>(figmaName: string, mapping: Record<string, V>): V {
    const [first] = Object.values(mapping);
    if (first === undefined) throw new Error(`figma.enum("${figmaName}"): empty mapping`);
    return first;
  },

  /** A Figma boolean property. */
  boolean(figmaName: string): boolean {
    return figmaName === "";
  },

  /** Nested layers, rendered as the component's children. */
  children(layers: string | string[]): ReactNode {
    return Array.isArray(layers) ? layers.join(", ") : layers;
  },

  /** The text of one named layer. */
  textContent(layer: string): string {
    return `{${layer}}`;
  },
};

export default figma;

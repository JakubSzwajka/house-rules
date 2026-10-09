import type { AstroIntegration } from "astro";

interface ElementNode {
  readonly tagName: string;
  readonly properties?: Readonly<Record<string, unknown>>;
}

interface VisitContext {
  setProperty(node: ElementNode, key: string, value: unknown): void;
  parent(node: ElementNode): ElementNode | undefined;
  textContent(node: ElementNode): string;
}

const accessibleBlocks = () => {
  const label = (node: ElementNode, context: VisitContext): void => {
    const { properties = {} } = node;
    if (properties["type"] !== "checkbox" || properties["ariaLabel"] !== undefined) {
      return;
    }
    const parent = context.parent(node);
    const text = parent === undefined ? "" : context.textContent(parent).trim();
    if (text !== "") {
      context.setProperty(node, "ariaLabel", text);
    }
  };
  return { name: "house-rules-accessible-blocks", element: { filter: ["input"], visit: label } };
};

export const accessibleBlocksIntegration = (): AstroIntegration => ({
  name: "house-rules-accessible-blocks",
  hooks: {
    "astro:config:setup": ({ config }) => {
      const processor = config.markdown.processor;
      if (processor.name !== "satteri") {
        throw new Error(
          `accessibleBlocks needs the satteri Markdown processor, not ${processor.name}.`,
        );
      }
      const options = processor.options as { hastPlugins?: unknown[] };
      options.hastPlugins = [...(options.hastPlugins ?? []), accessibleBlocks];
    },
  },
});

interface BlockNode {
  readonly type?: string;
  readonly tagName?: string;
  properties?: Record<string, unknown>;
  readonly children?: readonly BlockNode[];
}

const focusScrollablePre = (node: BlockNode, label: string): void => {
  if (node.tagName === "pre") {
    const properties = (node.properties ??= {});
    properties["tabindex"] = 0;
    properties["role"] = "region";
    properties["aria-label"] = label;
  }
  for (const child of node.children ?? []) {
    focusScrollablePre(child, label);
  }
};

interface BlockContext {
  readonly renderData: { blockAst: BlockNode };
  readonly codeBlock: {
    readonly language: string;
    readonly parentDocument?:
      | {
          readonly positionInDocument?: { readonly groupIndex: number } | undefined;
        }
      | undefined;
  };
}

export const focusableCodeBlocks = {
  name: "house-rules-focusable-code-blocks",
  hooks: {
    postprocessRenderedBlock: ({ renderData, codeBlock }: BlockContext): void => {
      const index = codeBlock.parentDocument?.positionInDocument?.groupIndex;
      const language = codeBlock.language === "" ? "text" : codeBlock.language;
      const name = index === undefined ? "Code block" : `Code block ${index + 1}`;
      focusScrollablePre(renderData.blockAst, `${name}, ${language}`);
    },
  },
};

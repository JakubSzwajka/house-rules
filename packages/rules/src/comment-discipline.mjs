import { isCommentException } from "./comment-directives.mjs";
import { contains, decoratedArea, groupComments, intersects } from "./comment-ranges.mjs";
import { ruleDocsUrl } from "./rule-docs.mjs";

const MESSAGE =
  "Rework this comment: remove it if it restates the code; prefer a clearer name, type, constant, assertion, or test. Keep only a necessary, non-obvious why in one line beside the constrained code.";

export const commentDisciplineRule = {
  meta: {
    type: "suggestion",
    docs: {
      url: ruleDocsUrl("comment-discipline"),
      description: "Keep comments local, short, and limited to necessary rationale.",
    },
    messages: {
      rework: MESSAGE,
    },
    schema: [],
  },

  create(context) {
    const sourceCode = context.sourceCode;
    const allowedRanges = [];
    const forbiddenRanges = [];

    function rememberFunctionBody(node) {
      if (node.type === "ArrowFunctionExpression" && node.expression) {
        const arrow = sourceCode
          .getTokens(node)
          .findLast((token) => token.value === "=>" && token.range[1] <= node.body.range[0]);
        const bodyStart = arrow?.range[1] ?? node.body.range[0];
        allowedRanges.push([bodyStart, node.range[1]]);
        forbiddenRanges.push([node.range[0], bodyStart]);
        return;
      }

      allowedRanges.push(node.body.range);
      forbiddenRanges.push([node.range[0], node.body.range[0]]);
    }

    function rememberClassBody(node) {
      allowedRanges.push(node.range);
    }

    function rememberClassHeader(node) {
      forbiddenRanges.push([node.range[0], node.body.range[0]]);
    }

    function rememberForbidden(node) {
      forbiddenRanges.push(node.range);
    }

    function rememberDecoratedArea(node) {
      const range = decoratedArea(node);
      if (range) forbiddenRanges.push(range);
    }

    function rememberMethod(node) {
      rememberDecoratedArea(node);
      if (node.value?.type === "TSEmptyBodyFunctionExpression") rememberForbidden(node);
    }

    return {
      ArrowFunctionExpression: rememberFunctionBody,
      ClassBody: rememberClassBody,
      ClassDeclaration: rememberClassHeader,
      ClassExpression: rememberClassHeader,
      FunctionDeclaration: rememberFunctionBody,
      FunctionExpression: rememberFunctionBody,
      TSAbstractMethodDefinition: rememberMethod,
      TSDeclareFunction: rememberForbidden,
      TSEmptyBodyFunctionExpression: rememberForbidden,
      TSInterfaceBody: rememberForbidden,
      TSInterfaceDeclaration: rememberForbidden,
      TSModuleBlock: rememberForbidden,
      TSTypeAliasDeclaration: rememberForbidden,
      TSTypeLiteral: rememberForbidden,
      Decorator: rememberForbidden,
      MethodDefinition: rememberMethod,
      PropertyDefinition: rememberDecoratedArea,
      "Program:exit"(program) {
        const firstCodeStart =
          sourceCode.getFirstToken(program)?.range[0] ?? sourceCode.text.length;

        for (const group of groupComments(sourceCode)) {
          if (group.every((comment) => isCommentException(comment, firstCodeStart))) continue;

          const first = group[0];
          const last = group.at(-1);
          const range = [first.range[0], last.range[1]];
          const onePhysicalLine = first.loc.start.line === last.loc.end.line;
          const insideAllowedBody = allowedRanges.some((allowed) => contains(allowed, range));
          const insideForbiddenArea = forbiddenRanges.some((forbidden) =>
            intersects(forbidden, range),
          );

          if (onePhysicalLine && insideAllowedBody && !insideForbiddenArea) continue;

          context.report({
            loc: {
              start: first.loc.start,
              end: last.loc.end,
            },
            messageId: "rework",
          });
        }
      },
    };
  },
};

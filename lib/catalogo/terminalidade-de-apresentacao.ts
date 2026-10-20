import type { ToolSet } from "ai";

/**
 * O SDK pode executar várias tools do mesmo passo em paralelo. Serializar as
 * execuções preserva a ordem em que ele as iniciou e impede qualquer efeito
 * de uma chamada irmã depois que a apresentação assume o turno.
 */
export function terminalizarApresentacaoNoTurno(
  tools: ToolSet,
  name: string,
  activated: () => void,
): ToolSet {
  let tail: Promise<unknown> = Promise.resolve();
  let terminal = false;
  return Object.fromEntries(
    Object.entries(tools).map(([toolName, definition]) => {
      if (typeof definition.execute !== "function") return [toolName, definition];
      const execute = definition.execute.bind(definition);
      return [
        toolName,
        {
          ...definition,
          execute: (input: never, options: never) => {
            const run = tail.then(async () => {
              if (terminal) {
                return {
                  ok: false,
                  error: { code: "catalog_presentation_terminal", message: "O turno terminou." },
                };
              }
              if (toolName === name) {
                terminal = true;
                activated();
              }
              return execute(input, options);
            });
            tail = run.catch(() => undefined);
            return run;
          },
        },
      ];
    }),
  );
}

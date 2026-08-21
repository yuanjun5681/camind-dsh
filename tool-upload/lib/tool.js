// Cordis string-output tool helper shared by the upload tool set.

export function toolDefinition(name, description, parameters, execute) {
  return {
    name,
    description,
    parameters,
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute,
  }
}

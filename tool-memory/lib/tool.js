// Cordis tool definition helper shared by the model-facing memory tools.

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

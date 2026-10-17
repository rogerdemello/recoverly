/**
 * Which integrations are wired, as booleans only. Never return or log credential values.
 */
export interface ConfigStatus {
  sandbox: boolean;
  llm: boolean;
  sendEnabled: boolean;
}

export function configStatus(): ConfigStatus {
  return {
    sandbox: Boolean(process.env.CREATEOS_SANDBOX_API_KEY ?? process.env.CREATEOS_PROJECT_API_KEY),
    llm: Boolean(process.env.OPENROUTER_API_KEY),
    // Customer message delivery is opt-in; anything other than the literal string "true" is off.
    sendEnabled: process.env.RECOVERLY_ENABLE_SEND === "true",
  };
}

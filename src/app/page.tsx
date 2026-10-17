import { configStatus } from "@/lib/config";

export const dynamic = "force-dynamic";

export default function Home() {
  const status = configStatus();
  const rows: Array<[string, boolean, string]> = [
    ["CreateOS Sandbox", status.sandbox, "CREATEOS_SANDBOX_API_KEY"],
    ["LLM provider", status.llm, "OPENROUTER_API_KEY"],
  ];

  return (
    <main>
      <h1>Recoverly</h1>
      <p className="lead">
        Failed-payment recovery agent. Analysis code is written by the agent and run in a CreateOS Sandbox.
      </p>
      <table>
        <thead>
          <tr>
            <th>Integration</th>
            <th>Status</th>
            <th>Variable</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, ok, variable]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{ok ? "Configured" : "Not configured"}</td>
              <td>
                <code>{variable}</code>
              </td>
            </tr>
          ))}
          <tr>
            <td>Customer message delivery</td>
            <td>{status.sendEnabled ? "Enabled" : "Disabled (draft-only)"}</td>
            <td>
              <code>RECOVERLY_ENABLE_SEND</code>
            </td>
          </tr>
        </tbody>
      </table>
    </main>
  );
}

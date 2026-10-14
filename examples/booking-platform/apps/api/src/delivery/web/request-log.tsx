import type { LoggedCall } from "./session.js";

type Props = Readonly<{ calls: ReadonlyArray<LoggedCall>; onClear: () => void }>;

export function RequestLog({ calls, onClear }: Props) {
  return (
    <aside>
      <h2>Request log</h2>
      <p className="hint">
        Every call the page makes, newest first. Watch the API terminal beside it.
      </p>
      <button type="button" onClick={onClear}>
        Clear
      </button>
      <table>
        <thead>
          <tr>
            <th>time</th>
            <th>method</th>
            <th>path</th>
            <th>status</th>
            <th>ms</th>
            <th>code</th>
          </tr>
        </thead>
        <tbody>
          {calls.map((call) => (
            <tr
              key={call.key}
              className={call.status >= 200 && call.status < 300 ? "ok" : "failed"}
            >
              <td>{call.at}</td>
              <td>{call.method}</td>
              <td>
                <code>{call.path}</code>
              </td>
              <td>{call.status}</td>
              <td>{call.ms}</td>
              <td>{call.code ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </aside>
  );
}

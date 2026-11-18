import { formatNumber } from '../operations'
import type { HistoryEntry } from '../history/history'

interface HistoryPanelProps {
  entries: HistoryEntry[]
  onSelect: (value: number) => void
  onClear: () => void
}

export function HistoryPanel({ entries, onSelect, onClear }: HistoryPanelProps) {
  return (
    <section className="history" aria-labelledby="history-title">
      <div className="history-header">
        <h2 id="history-title">History</h2>
        {entries.length > 0 && (
          <button type="button" className="history-clear" onClick={onClear}>
            Clear
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <p className="history-empty">Your calculations will appear here.</p>
      ) : (
        <ol className="history-list">
          {entries.map((entry) => {
            const result = formatNumber(entry.result)
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className="history-item"
                  title="Use this result"
                  aria-label={`${entry.expression} = ${result}. Use this result`}
                  onClick={() => onSelect(entry.result)}
                >
                  <span className="history-expression">{entry.expression} =</span>
                  <span className="history-result">{result}</span>
                </button>
              </li>
            )
          })}
        </ol>
      )}

      <p className="history-note">Saved in this browser only. Nothing is sent to the server.</p>
    </section>
  )
}

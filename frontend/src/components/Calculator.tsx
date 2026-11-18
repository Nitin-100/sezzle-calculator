import { useEffect, type ReactNode } from 'react'
import type { CalculationKey, CalculatorAction, CalculatorState } from '../calculator/engine'
import { commandForKey } from '../calculator/engine'

interface CalculatorProps {
  state: CalculatorState
  busy: boolean
  input: (action: CalculatorAction) => void
  press: (key: CalculationKey) => void
}

export function Calculator({ state, busy, input, press }: CalculatorProps) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return
      // Buttons outside the keypad (such as history items) keep their own Enter and Space behaviour.
      if ((event.key === 'Enter' || event.key === ' ') && isOutsideKeypad(event.target)) return
      const command = commandForKey(event.key)
      if (!command) return
      // Stops Enter from also clicking a focused key and "/" from opening browser search.
      event.preventDefault()
      if (command.kind === 'action') input(command.action)
      else press(command.key)
    }

    function onPaste(event: ClipboardEvent) {
      const text = event.clipboardData?.getData('text')
      if (text) input({ type: 'paste', text })
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('paste', onPaste)
    }
  }, [input, press])

  const digit = (d: string) => <Key label={d} variant="digit" onPress={() => input({ type: 'digit', digit: d })} />

  const op = (key: CalculationKey, label: ReactNode, name: string, shortcut: string) => (
    <Key
      label={label}
      name={name}
      shortcut={shortcut}
      variant="operator"
      pressed={key === 'sqrt' ? undefined : state.awaitingOperand && state.operator === key}
      onPress={() => press(key)}
    />
  )

  return (
    <section className="calculator" aria-label="Calculator" aria-busy={busy}>
      <div className="display">
        <div className="display-expression" data-testid="expression">
          {state.expression}
        </div>
        <output
          className={state.entry.length > 12 ? 'display-entry display-entry-small' : 'display-entry'}
          data-testid="display"
          aria-live="polite"
        >
          {state.error ? <span className="display-error">{state.error}</span> : state.entry}
        </output>
      </div>

      <div className="keypad">
        <Key label="AC" name="All clear" shortcut="Esc" variant="function" onPress={() => input({ type: 'clear' })} />
        <Key
          label="DEL"
          name="Backspace"
          shortcut="Backspace"
          variant="function"
          onPress={() => input({ type: 'backspace' })}
        />
        {op('sqrt', 'sqrt', 'Square root', 'r')}
        {op(
          'power',
          <>
            x<sup>y</sup>
          </>,
          'Power',
          '^',
        )}

        {digit('7')}
        {digit('8')}
        {digit('9')}
        {op('divide', '/', 'Divide', '/')}

        {digit('4')}
        {digit('5')}
        {digit('6')}
        {op('multiply', 'x', 'Multiply', '*')}

        {digit('1')}
        {digit('2')}
        {digit('3')}
        {op('subtract', '-', 'Subtract', '-')}

        {digit('0')}
        <Key label="." name="Decimal point" variant="digit" onPress={() => input({ type: 'decimal' })} />
        <Key label="+/-" name="Change sign" variant="digit" onPress={() => input({ type: 'toggleSign' })} />
        {op('add', '+', 'Add', '+')}

        {op('percentage', '%', 'Percent of', '%')}
        <Key label="=" name="Equals" shortcut="Enter" variant="equals" onPress={() => press('equals')} />
      </div>

      <p className="hint">You can also use your keyboard or paste a number.</p>
    </section>
  )
}

function isOutsideKeypad(target: EventTarget | null): boolean {
  return target instanceof HTMLButtonElement && !target.closest('.keypad')
}

interface KeyProps {
  label: ReactNode
  name?: string
  shortcut?: string
  variant: 'digit' | 'operator' | 'function' | 'equals'
  pressed?: boolean
  onPress: () => void
}

function Key({ label, name, shortcut, variant, pressed, onPress }: KeyProps) {
  return (
    <button
      type="button"
      className={`key key-${variant}`}
      aria-label={name}
      aria-pressed={pressed}
      title={name && shortcut ? `${name} (${shortcut})` : name}
      onClick={onPress}
    >
      {label}
    </button>
  )
}

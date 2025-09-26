import { serializeError } from 'serialize-error';
import CloseIcon from 'mdi-preact/CloseIcon';

export function printer(
  appendMessage: (msg: ['warn' | 'error', string]) => void,
) {
  return {
    warn: (msg: string) => appendMessage(['warn', msg]),
    error: (err: Error | unknown) => {
      console.error(err);
      appendMessage([
        'error',
        'Unexpected internal error: ' + JSON.stringify(serializeError(err)),
      ]);
    },
  };
}

interface MessagesProps {
  messages: ['warn' | 'error', string][];
  removeMessage: (i: number) => void;
}

export function Messages(props: MessagesProps) {
  if (props.messages.length === 0) return undefined;
  return (
    <div class={'row'}>
      <div class={'col'}>
        {props.messages.map(([type, msg], i) => (
          <div
            key={`warning-${i}`}
            className={`alert alert-${
              type === 'warn' ? 'warning' : 'danger'
            } home--alert`}
            role="alert"
            onClick={() => props.removeMessage(i)}
          >
            <CloseIcon /> {msg}
          </div>
        ))}
      </div>
    </div>
  );
}

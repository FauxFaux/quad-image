import { serializeError } from 'serialize-error';

export function printer(
  appendMessage: (msg: ['warn' | 'error', string]) => void,
) {
  return {
    warn: (msg: string) => appendMessage(['warn', msg]),
    error: (err: Error | unknown) =>
      appendMessage([
        'error',
        'Unexpected internal error: ' + JSON.stringify(serializeError(err)),
      ]),
  };
}

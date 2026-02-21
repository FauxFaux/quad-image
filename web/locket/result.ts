import { Printer } from '../components/upload';
import ensureError from 'ensure-error';

export function orPrinter(f: () => Promise<void>, printer: Printer) {
  f().catch((err: unknown) => {
    printer.error(ensureError(err));
  });
}

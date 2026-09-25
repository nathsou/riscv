/** Open a program in the Lab, keeping the user's current program restorable. */
import { session, setSource, backupSource } from '../app/session.ts';
import { navigate } from '../ui/router.ts';
import { toast } from '../ui/components/tooltip.ts';

export function loadIntoLab(source: string, title: string): void {
  if (session.source.peek() !== source) backupSource();
  setSource(source);
  navigate('/lab');
  toast(`Loaded “${title}”. Your previous program can be restored from Examples.`);
}

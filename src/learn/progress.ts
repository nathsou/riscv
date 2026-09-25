/** Local progress through the guided tour (visited chapters, quiz answers). */
import { loadJSON, saveJSON } from '../app/storage.ts';
import { signal } from '../ui/reactive.ts';

interface Progress { visited: Record<string, boolean>; quiz: Record<string, boolean> }

export const progress = signal<Progress>(loadJSON<Progress>('learn-progress', { visited: {}, quiz: {} }));
progress.subscribe(p => saveJSON('learn-progress', p));

export function markVisited(id: string): void {
  const p = progress.peek();
  if (p.visited[id]) return;
  progress.value = { ...p, visited: { ...p.visited, [id]: true } };
}

export function recordQuiz(id: string, correct: boolean): void {
  const p = progress.peek();
  if (p.quiz[id] === true) return; // keep the first correct answer
  progress.value = { ...p, quiz: { ...p.quiz, [id]: correct } };
}

export function resetProgress(): void { progress.value = { visited: {}, quiz: {} }; }

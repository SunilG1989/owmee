import { InteractionManager } from 'react-native';

export function afterInteractions(task: () => void | Promise<void>): () => void {
  const handle = InteractionManager.runAfterInteractions(() => {
    void task();
  });
  return () => {
    handle.cancel?.();
  };
}

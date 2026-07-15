export interface SpawnEventSource {
  once(event: 'spawn', listener: () => void): this;
  once(event: 'error', listener: (error: Error) => void): this;
  removeListener(event: 'spawn', listener: () => void): this;
  removeListener(event: 'error', listener: (error: Error) => void): this;
}

export interface TerminableProcess {
  readonly exitCode: number | null;
  kill(): boolean;
  once(event: 'exit' | 'close', listener: () => void): this;
  removeListener(event: 'exit' | 'close', listener: () => void): this;
}

export async function terminateProcess(child: TerminableProcess, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be positive.');
  }
  if (child.exitCode !== null) return;

  await new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('exit', onTerminated);
      child.removeListener('close', onTerminated);
    };
    const onTerminated = () => {
      cleanup();
      resolve();
    };

    child.once('exit', onTerminated);
    child.once('close', onTerminated);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Child process did not exit within ${timeoutMs}ms.`));
    }, timeoutMs);

    try {
      if (!child.kill()) {
        cleanup();
        reject(new Error('Child process refused the termination signal.'));
      }
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function waitForSpawn(child: SpawnEventSource, timeoutMs: number): Promise<void> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new RangeError('timeoutMs must be positive.'));
  }

  return new Promise<void>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      child.removeListener('spawn', onSpawn);
      child.removeListener('error', onError);
    };
    const onSpawn = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    child.once('spawn', onSpawn);
    child.once('error', onError);
    timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Child process did not emit spawn within ${timeoutMs}ms.`));
    }, timeoutMs);
  });
}
